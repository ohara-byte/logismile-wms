/**
 * GET /api/stocks/match?date=YYYY-MM-DD
 *
 * Sprint Z-3: 商品検品照合（管理 PC 用）
 *  - 該当日に出荷予定の SKU について、引当・在庫・不足を SKU 単位で集計
 *  - 当日のハンディ在庫検品（StockMovement.type='inspection_count'）も同時に表示
 *
 * 認証: admin/manager/lead 閲覧可（master_view）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/auth/permissions';
import { parseDateAsUTC, addDaysUTC, todayJstAsUTC } from '@/lib/date-utils';

const Query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(req: Request) {
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const parsed = Query.safeParse({
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

  // @db.Date と揃えるため UTC 真夜中で扱う（setHours はJSTコンテナで前日にずれるため使わない）
  const targetDate = parsed.data.date
    ? (parseDateAsUTC(parsed.data.date) ?? todayJstAsUTC())
    : todayJstAsUTC();
  const nextDate = addDaysUTC(targetDate, 1);

  // 該当日の全出荷指示明細（活生）
  const items = await prisma.shippingOrderItem.findMany({
    where: {
      order: {
        deletedAt: null,
        shipDate: { gte: targetDate, lt: nextDate },
        // 状態は問わない（出荷済みも含めて全体の引当傾向を見る）
      },
    },
    include: {
      order: {
        select: { id: true, pkNo: true, status: true },
      },
      product: {
        select: { name: true, jan: true, productType: true },
      },
    },
  });

  // SKU 単位に集計
  const map = new Map<
    string,
    {
      productCode: string;
      productName: string;
      productJan: string | null;
      productType: string;
      requiredQty: number;
      orderIds: Set<string>;
    }
  >();
  for (const it of items) {
    const ex = map.get(it.productCode);
    if (ex) {
      ex.requiredQty += it.qty;
      ex.orderIds.add(it.orderId);
    } else {
      map.set(it.productCode, {
        productCode: it.productCode,
        productName: it.product.name,
        productJan: it.product.jan,
        productType: it.product.productType,
        requiredQty: it.qty,
        orderIds: new Set([it.orderId]),
      });
    }
  }

  // ① 検品済/未検品サマリ（伝票単位）：対象日の出荷指示を状態別に集計
  const orderStatusById = new Map<string, string>();
  for (const it of items) orderStatusById.set(it.orderId, it.order.status);
  const orderSummary = { total: 0, done: 0, inspecting: 0, pending: 0, held: 0 };
  for (const st of orderStatusById.values()) {
    orderSummary.total++;
    if (st === 'packed' || st === 'shipped') orderSummary.done++;
    else if (st === 'inspecting') orderSummary.inspecting++;
    else if (st === 'held') orderSummary.held++;
    else orderSummary.pending++;
  }

  // 各 SKU の引当・在庫を集計
  const productCodes = Array.from(map.keys());
  if (productCodes.length === 0) {
    return NextResponse.json({
      data: { items: [], summary: { skuCount: 0, fullCount: 0, partialCount: 0, shortCount: 0 } },
      message: 'OK',
    });
  }

  const allocations =
    productCodes.length > 0
      ? await prisma.allocation.findMany({
          where: {
            productCode: { in: productCodes },
            status: { not: 'released' },
            order: {
              shipDate: { gte: targetDate, lt: nextDate },
              deletedAt: null,
            },
          },
          select: { productCode: true, qty: true, status: true },
        })
      : [];
  const allocBySku = new Map<string, { reserved: number; fulfilled: number }>();
  for (const a of allocations) {
    const ex = allocBySku.get(a.productCode) ?? { reserved: 0, fulfilled: 0 };
    if (a.status === 'fulfilled') ex.fulfilled += a.qty;
    else ex.reserved += a.qty;
    allocBySku.set(a.productCode, ex);
  }

  const stocks = await prisma.stock.findMany({
    where: { productCode: { in: productCodes } },
    select: {
      productCode: true,
      qty: true,
      allocatedQty: true,
      inspectedAt: true,
      inspectedBy: true,
    },
  });
  const stockBySku = new Map(stocks.map((s) => [s.productCode, s]));

  // 当日の在庫検品ログ（type='inspection_count'）
  const movements = await prisma.stockMovement.findMany({
    where: {
      productCode: { in: productCodes },
      type: 'inspection_count',
      createdAt: { gte: targetDate, lt: nextDate },
    },
    orderBy: { createdAt: 'desc' },
  });
  const moveBySku = new Map<string, typeof movements>();
  for (const m of movements) {
    const arr = moveBySku.get(m.productCode) ?? [];
    arr.push(m);
    moveBySku.set(m.productCode, arr);
  }

  // ③ Phase 2: 対象「発送日」の工場納品数（発送日で色分け）。
  //   CraftSmile が発送日を付けて納品した inbound を ship_date 一致で集計する。
  //   発送日未指定（Phase1前の在庫）は含まれない＝新しい納品から順に反映される。
  const deliveredRows = await prisma.stockMovement.groupBy({
    by: ['productCode'],
    where: {
      productCode: { in: productCodes },
      type: 'inbound',
      refType: 'factory_delivery',
      shipDate: targetDate,
    },
    _sum: { qtyDelta: true },
  });
  const deliveredForDateBySku = new Map(
    deliveredRows.map((r) => [r.productCode, r._sum.qtyDelta ?? 0]),
  );

  // 整形
  let fullCount = 0;
  let partialCount = 0;
  let shortCount = 0;
  const out = Array.from(map.values()).map((row) => {
    const alloc = allocBySku.get(row.productCode) ?? { reserved: 0, fulfilled: 0 };
    const stock = stockBySku.get(row.productCode);
    const allocatedTotal = alloc.reserved + alloc.fulfilled;
    const shortageQty = Math.max(row.requiredQty - allocatedTotal, 0);
    const status: 'full' | 'partial' | 'short' =
      allocatedTotal >= row.requiredQty
        ? 'full'
        : allocatedTotal > 0
          ? 'partial'
          : 'short';
    if (status === 'full') fullCount++;
    else if (status === 'partial') partialCount++;
    else shortCount++;

    const inspections = (moveBySku.get(row.productCode) ?? []).map((m) => ({
      qtyDelta: m.qtyDelta,
      createdAt: m.createdAt.toISOString(),
      createdBy: m.createdBy,
    }));

    return {
      productCode: row.productCode,
      productName: row.productName,
      productJan: row.productJan,
      productType: row.productType,
      requiredQty: row.requiredQty,
      reservedQty: alloc.reserved,
      fulfilledQty: alloc.fulfilled,
      allocatedQty: allocatedTotal,
      shortageQty,
      // ③ Phase 2: 対象発送日にCraftSmileから納品された数（発送日で色分け）
      deliveredForDate: deliveredForDateBySku.get(row.productCode) ?? 0,
      orderCount: row.orderIds.size,
      stock: stock
        ? {
            qty: stock.qty,
            allocatedQty: stock.allocatedQty,
            availableQty: Math.max(stock.qty - stock.allocatedQty, 0),
            inspectedAt: stock.inspectedAt?.toISOString() ?? null,
            inspectedBy: stock.inspectedBy,
          }
        : null,
      inspections,
      status,
    };
  });

  // 不足→部分→完了の順で並べる（要対応を先頭に）
  const orderRank: Record<'short' | 'partial' | 'full', number> = {
    short: 0,
    partial: 1,
    full: 2,
  };
  out.sort((a, b) => {
    const r = orderRank[a.status] - orderRank[b.status];
    if (r !== 0) return r;
    return b.requiredQty - a.requiredQty;
  });

  return NextResponse.json({
    data: {
      items: out,
      orderSummary,
      summary: {
        skuCount: out.length,
        fullCount,
        partialCount,
        shortCount,
      },
      targetDate: targetDate.toISOString().slice(0, 10),
    },
    message: 'OK',
  });
}
