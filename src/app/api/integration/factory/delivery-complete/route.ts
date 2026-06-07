/**
 * POST /api/integration/factory/delivery-complete
 *
 * Sprint Z-8: 当日納品完了通知 → 出荷残の自動翌日繰越（Q3=A）。
 *  - factory_api モード時のみ動作
 *  - 引当未完了の出荷指示の shipDate を翌日に進める
 *  - 余剰在庫はそのまま Stock に残し、翌日の引当に使われる（Q4=B）
 *
 * 詳細は デスクトップ「WMS_工場連携IF仕様書_v0.1.md」§3-3 参照。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isFactoryApiMode } from '@/lib/integration/factory-mode';
import {
  verifyFactoryRequest,
  checkIdempotency,
  rememberIdempotency,
} from '@/lib/integration/factory-auth';
import { runDailyCarryover } from '@/lib/allocation/daily-carryover';

const Body = z.object({
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalDeliveries: z.number().int().min(0).optional(),
  completedAt: z.string().datetime().optional(),
  summary: z
    .array(
      z.object({
        productCode: z.string().min(1).max(20),
        totalQty: z.number().int().min(0),
      }),
    )
    .optional(),
});

export async function POST(req: Request) {
  if (!isFactoryApiMode()) {
    return NextResponse.json(
      {
        data: null,
        message: '工場連携モードが有効ではありません',
        error: 'MODE_DISABLED',
      },
      { status: 503 },
    );
  }

  const rawBody = await req.text();

  const auth = verifyFactoryRequest(req, rawBody);
  if (!auth.ok) {
    return NextResponse.json(
      { data: null, message: auth.message, error: 'AUTH' },
      { status: auth.status },
    );
  }
  const idem = checkIdempotency(auth.idempotencyKey);
  if (idem.duplicate) {
    return NextResponse.json(idem.response, { status: 200 });
  }

  let parsed;
  try {
    parsed = Body.safeParse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json(
      { data: null, message: '不正な JSON', error: 'VALIDATION' },
      { status: 400 },
    );
  }
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        message: parsed.error.issues.map((i) => i.message).join(', '),
        error: 'VALIDATION',
      },
      { status: 422 },
    );
  }

  const result = await runDailyCarryover(parsed.data.targetDate, 'factory_api');

  // 余剰在庫 SKU の集計
  const targetDate = new Date(parsed.data.targetDate);
  targetDate.setHours(0, 0, 0, 0);
  const nextDate = new Date(targetDate);
  nextDate.setDate(nextDate.getDate() + 1);
  const surplusStocks = await prisma.stock.findMany({
    where: { qty: { gt: 0 } },
    select: { productCode: true, qty: true, allocatedQty: true },
  });
  const surplusSkus = surplusStocks.filter(
    (s) => Math.max(s.qty - s.allocatedQty, 0) > 0,
  ).length;

  const responseBody = {
    data: {
      targetDate: parsed.data.targetDate,
      carryoverOrders: result.orderCount,
      carryoverItems: result.itemCount,
      surplusSkus,
      report: `/dashboard?tab=stockmatch&date=${parsed.data.targetDate}`,
    },
    message: 'OK',
  };
  rememberIdempotency(auth.idempotencyKey, responseBody);
  return NextResponse.json(responseBody);
}
