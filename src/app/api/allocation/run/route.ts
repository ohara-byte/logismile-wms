/**
 * POST /api/allocation/run
 *
 * Sprint Z-1: 引当ラン
 *  - クエリ: productCode（指定 SKU を含む未引当注文をすべて再引当）/ shipDate（バッチ）
 *  - 認証: admin / manager / staff
 *  - 用途:
 *      在庫検品でカウント反映後、自動的に呼び出される（ハンディ）
 *      または PC から手動実行（管理画面ボタン）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import {
  allocateOrder,
  createDraftInstructionsFromShortages,
} from '@/lib/allocation/allocate-order';

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const productCode = searchParams.get('productCode');
  const shipDateStr = searchParams.get('shipDate');

  // 対象注文の特定
  // - productCode 指定 → その SKU を含む未完了注文を全件
  // - shipDate 指定 → その日の未完了注文を全件
  // - 両方なし → 今日の未完了注文を全件
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const baseWhere = {
    deletedAt: null,
    status: { in: ['pending', 'inspecting', 'held'] },
    ...(shipDateStr
      ? {
          shipDate: {
            gte: new Date(shipDateStr),
            lt: new Date(
              new Date(shipDateStr).setDate(
                new Date(shipDateStr).getDate() + 1,
              ),
            ),
          },
        }
      : !productCode
        ? { shipDate: { gte: today, lt: tomorrow } }
        : {}),
    ...(productCode
      ? { items: { some: { productCode } } }
      : {}),
  };

  const orders = await prisma.shippingOrder.findMany({
    where: baseWhere,
    select: { pkNo: true },
    orderBy: [{ shipDate: 'asc' }, { createdAt: 'asc' }],
    take: 100000, // 2026-06-04: 上限実質撤廃（旧500では引当の取りこぼしの恐れ）
  });

  let triggered = 0;
  let allocated = 0;
  const shortages: Array<{
    pkNo: string;
    productCode: string;
    shortageQty: number;
  }> = [];
  const aggregateShortages: Array<{ productCode: string; shortageQty: number }> = [];

  for (const { pkNo } of orders) {
    triggered++;
    try {
      const r = await allocateOrder(pkNo);
      const allocSum = r.allocations.reduce((s, a) => s + a.allocatedQty, 0);
      if (allocSum > 0) allocated++;
      for (const s of r.shortages) {
        shortages.push({ pkNo, productCode: s.productCode, shortageQty: s.shortageQty });
        const found = aggregateShortages.find(
          (x) => x.productCode === s.productCode,
        );
        if (found) found.shortageQty += s.shortageQty;
        else aggregateShortages.push({ ...s });
      }
    } catch (e) {
      console.warn(`[allocation/run] ${pkNo}:`, e);
    }
  }

  let draftInstructions = 0;
  if (aggregateShortages.length > 0) {
    try {
      await createDraftInstructionsFromShortages(aggregateShortages, {
        requestedBy: guard.auth.staffCode ?? null,
      });
      draftInstructions = aggregateShortages.length;
    } catch (e) {
      console.warn('[allocation/run] draft instructions failed:', e);
    }
  }

  return NextResponse.json({
    data: { triggered, allocated, shortages, draftInstructions },
    message: 'OK',
  });
}
