/**
 * GET /api/integration/factory/orders?date=YYYY-MM-DD
 *
 * Sprint Z-8: 製造システム側が当日の必要数を取得する Pull 型エンドポイント。
 *  - HMAC 検証必要（GET でも署名チェック）
 *  - factory_api モード時のみ
 *
 * 詳細は デスクトップ「WMS_工場連携IF仕様書_v0.1.md」§3-4 参照。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isFactoryApiMode } from '@/lib/integration/factory-mode';
import { verifyFactoryRequest } from '@/lib/integration/factory-auth';
import { parseDateAsUTC, addDaysUTC, todayJstAsUTC } from '@/lib/date-utils';

const Query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: Request) {
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

  // GET でも署名検証（ボディは空文字）
  const auth = verifyFactoryRequest(req, '');
  if (!auth.ok) {
    return NextResponse.json(
      { data: null, message: auth.message, error: 'AUTH' },
      { status: auth.status },
    );
  }

  const { searchParams } = new URL(req.url);
  const parsed = Query.safeParse({ date: searchParams.get('date') });
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        message: 'date クエリ必須 (YYYY-MM-DD)',
        error: 'VALIDATION',
      },
      { status: 422 },
    );
  }

  // 日付根治(2026-07-02): shipDate(@db.Date)は UTC 真夜中で照会。
  const start = parseDateAsUTC(parsed.data.date) ?? todayJstAsUTC();
  const end = addDaysUTC(start, 1);

  // 出荷指示明細を SKU 単位で集計
  const items = await prisma.shippingOrderItem.findMany({
    where: {
      order: {
        shipDate: { gte: start, lt: end },
        deletedAt: null,
      },
    },
    include: {
      product: {
        select: { name: true, productType: true },
      },
    },
  });

  // SKU 別集計
  const map = new Map<
    string,
    {
      productCode: string;
      productName: string;
      productType: string;
      requiredQty: number;
    }
  >();
  for (const it of items) {
    const ex = map.get(it.productCode);
    if (ex) {
      ex.requiredQty += it.qty;
    } else {
      map.set(it.productCode, {
        productCode: it.productCode,
        productName: it.product.name,
        productType: it.product.productType,
        requiredQty: it.qty,
      });
    }
  }
  const codes = Array.from(map.keys());

  // 既存引当
  const allocs =
    codes.length > 0
      ? await prisma.allocation.groupBy({
          by: ['productCode'],
          where: {
            productCode: { in: codes },
            status: { not: 'released' },
            order: { shipDate: { gte: start, lt: end }, deletedAt: null },
          },
          _sum: { qty: true },
        })
      : [];
  const allocBySku = new Map(
    allocs.map((a) => [a.productCode, a._sum.qty ?? 0]),
  );

  // 当日の製造指示
  const instructions =
    codes.length > 0
      ? await prisma.manufacturingInstruction.findMany({
          where: {
            productCode: { in: codes },
            targetDate: { gte: start, lt: end },
            status: { not: 'cancelled' },
          },
          select: {
            productCode: true,
            instructionNo: true,
            qty: true,
            status: true,
          },
        })
      : [];
  const insBySku = new Map<string, typeof instructions>();
  for (const ins of instructions) {
    const arr = insBySku.get(ins.productCode) ?? [];
    arr.push(ins);
    insBySku.set(ins.productCode, arr);
  }

  return NextResponse.json({
    data: {
      targetDate: parsed.data.date,
      items: Array.from(map.values()).map((row) => ({
        productCode: row.productCode,
        productName: row.productName,
        productType: row.productType,
        requiredQty: row.requiredQty,
        allocatedQty: allocBySku.get(row.productCode) ?? 0,
        instructions: (insBySku.get(row.productCode) ?? []).map((ins) => ({
          instructionNo: ins.instructionNo,
          qty: ins.qty,
          status: ins.status,
        })),
      })),
    },
    message: 'OK',
  });
}
