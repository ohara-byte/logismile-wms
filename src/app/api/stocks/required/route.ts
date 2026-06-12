/**
 * GET /api/stocks/required?productCode=XXX&date=YYYY-MM-DD
 *
 * Sprint Z-2: ハンディ在庫検品で「該当日の必要数」を取得するエンドポイント。
 *  - 認証: admin / manager / staff（モバイル含む）
 *  - 該当日に出荷予定（pending / inspecting / held）のうち、
 *    productCode を含むものの「需要数（qty）」と「既存引当数」を集計
 *  - 戻り値:
 *      productCode / productName
 *      stock: { qty, allocatedQty, availableQty }
 *      requiredQty: 該当日に必要な総量
 *      allocatedQty: 既に引当済の総量（Allocation 集計）
 *      shortageQty: 不足数（max(required - allocated - available, 0)）
 *      orderCount: 該当日の伝票数
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Query = z.object({
  productCode: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const parsed = Query.safeParse({
    productCode: searchParams.get('productCode'),
    date: searchParams.get('date') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: parsed.error.issues.map((i) => i.message).join(', '),
      },
      { status: 422 },
    );
  }

  const { productCode } = parsed.data;
  const targetDate = parsed.data.date
    ? new Date(parsed.data.date)
    : new Date();
  targetDate.setHours(0, 0, 0, 0);
  const nextDate = new Date(targetDate);
  nextDate.setDate(nextDate.getDate() + 1);

  // 商品とJANで検索
  let product = await prisma.product.findUnique({
    where: { code: productCode },
    select: { code: true, name: true, jan: true, productType: true, shippableExpiryDays: true },
  });
  if (!product) {
    const byJan = await prisma.product.findFirst({
      where: { jan: productCode },
      select: { code: true, name: true, jan: true, productType: true, shippableExpiryDays: true },
    });
    if (byJan) product = byJan;
  }
  if (!product) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: '商品が見つかりません' },
      { status: 404 },
    );
  }

  // Stock 行（無ければ qty=0 で作成）
  const stock = await prisma.stock.upsert({
    where: { productCode: product.code },
    create: { productCode: product.code, qty: 0, allocatedQty: 0 },
    update: {},
  });

  // 該当日の出荷指示で当該 SKU を含むもの
  const items = await prisma.shippingOrderItem.findMany({
    where: {
      productCode: product.code,
      order: {
        deletedAt: null,
        status: { in: ['pending', 'inspecting', 'held'] },
        shipDate: { gte: targetDate, lt: nextDate },
      },
    },
    select: { qty: true, orderId: true },
  });
  const requiredQty = items.reduce((s, it) => s + it.qty, 0);
  const orderIds = Array.from(new Set(items.map((i) => i.orderId)));
  const orderCount = orderIds.length;

  // 該当出荷指示への既存引当（released を除く）
  const allocs =
    orderIds.length > 0
      ? await prisma.allocation.findMany({
          where: {
            productCode: product.code,
            orderId: { in: orderIds },
            status: { not: 'released' },
          },
          select: { qty: true },
        })
      : [];
  const allocatedQtyForDate = allocs.reduce((s, a) => s + a.qty, 0);

  // 不足 = max(必要数 - 既存引当 - 利用可能, 0)
  const availableQty = Math.max(stock.qty - stock.allocatedQty, 0);
  const stillNeed = Math.max(requiredQty - allocatedQtyForDate, 0);
  const shortageQty = Math.max(stillNeed - availableQty, 0);

  return NextResponse.json({
    data: {
      productCode: product.code,
      productName: product.name,
      productJan: product.jan,
      productType: product.productType,
      // A：発送可能賞味期限（日数）。在庫検品完了後バナーの算出源（入庫日+日数-1）
      shippableExpiryDays: product.shippableExpiryDays,
      targetDate: targetDate.toISOString().slice(0, 10),
      stock: {
        qty: stock.qty,
        allocatedQty: stock.allocatedQty,
        availableQty,
      },
      requiredQty,
      allocatedQty: allocatedQtyForDate,
      stillNeed,
      shortageQty,
      orderCount,
    },
    message: 'OK',
  });
}
