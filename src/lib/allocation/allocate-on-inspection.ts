/**
 * 受注生産（made_to_order）の検品時引当
 *
 * Sprint Z-5:
 *  - 受注生産品は伝票引当しない
 *  - 検品セッション開始時、当日の Stock プールから FIFO（=セッション開始の早い順）で引き当てる
 *  - 当日の同一 SKU について、自分より startedAt が早く完了していないセッションが優先
 *
 * 競合制御は Stock.allocatedQty の楽観ロック更新で守る（allocate-order と同じ方式）。
 */

import { prisma } from '@/lib/db';

export interface InspectionAllocResult {
  orderId: string;
  pkNo: string;
  allocations: Array<{
    productCode: string;
    requestedQty: number;
    allocatedQty: number;
    source: 'made_to_order';
  }>;
  shortages: Array<{ productCode: string; shortageQty: number }>;
  fullyAllocated: boolean;
}

/**
 * 1 セッションの開始タイミングで MTO 商品のみ引当を試みる。
 * - 同一 orderId × productCode に既存 reserved/fulfilled 行があれば加算
 * - 受注生産以外の商品は無視（既に allocate-order で処理済み）
 */
export async function allocateMtoForOrder(
  orderId: string,
): Promise<InspectionAllocResult> {
  const order = await prisma.shippingOrder.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      allocations: { where: { status: { not: 'released' } } },
    },
  });
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const result: InspectionAllocResult = {
    orderId,
    pkNo: order.pkNo,
    allocations: [],
    shortages: [],
    fullyAllocated: true,
  };

  // 商品種別をまとめて取得
  const productCodes = Array.from(new Set(order.items.map((i) => i.productCode)));
  if (productCodes.length === 0) return result;

  const products = await prisma.product.findMany({
    where: { code: { in: productCodes } },
    select: { code: true, productType: true },
  });
  const typeBySku = new Map(products.map((p) => [p.code, p.productType]));

  // 既存引当 by SKU（released を除く）
  const allocatedBySku = new Map<string, number>();
  for (const a of order.allocations) {
    allocatedBySku.set(
      a.productCode,
      (allocatedBySku.get(a.productCode) ?? 0) + a.qty,
    );
  }

  // 必要数（MTO のみ）
  for (const item of order.items) {
    const ptype = typeBySku.get(item.productCode);
    if (ptype !== 'made_to_order') continue;
    const already = allocatedBySku.get(item.productCode) ?? 0;
    const need = Math.max(item.qty - already, 0);
    if (need <= 0) continue;

    const allocated = await tryAllocateFromPool(
      orderId,
      order.pkNo,
      item.productCode,
      need,
    );
    result.allocations.push({
      productCode: item.productCode,
      requestedQty: need,
      allocatedQty: allocated,
      source: 'made_to_order',
    });
    if (allocated < need) {
      result.shortages.push({
        productCode: item.productCode,
        shortageQty: need - allocated,
      });
      result.fullyAllocated = false;
    }
  }

  return result;
}

/**
 * Stock プールから引き当てる（楽観ロック付き）。
 *
 * 2026-06-01 バグレビュー C-4: Stock 増分・Allocation upsert・StockMovement を
 *   単一トランザクションにまとめ、途中失敗で allocatedQty がリークしないようにした。
 *   楽観ロック（updateMany の条件付き increment + 1 回リトライ）は維持。
 */
async function tryAllocateFromPool(
  orderId: string,
  pkNo: string,
  productCode: string,
  requestedQty: number,
): Promise<number> {
  // Stock 行を確保（トランザクション外でよい：存在保証のみ）
  await prisma.stock.upsert({
    where: { productCode },
    create: { productCode, qty: 0, allocatedQty: 0 },
    update: {},
  });

  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.findUnique({ where: { productCode } });
    if (!stock) return 0;

    let take = Math.min(Math.max(stock.qty - stock.allocatedQty, 0), requestedQty);
    if (take <= 0) return 0;

    let updated = await tx.stock.updateMany({
      where: {
        productCode,
        allocatedQty: { lte: stock.qty - take },
        qty: { equals: stock.qty },
      },
      data: { allocatedQty: { increment: take } },
    });

    if (updated.count === 0) {
      // 1 度だけリトライ（他トランザクションのコミットで条件不一致になった場合）
      const retry = await tx.stock.findUnique({ where: { productCode } });
      if (!retry) return 0;
      take = Math.min(Math.max(retry.qty - retry.allocatedQty, 0), requestedQty);
      if (take <= 0) return 0;
      updated = await tx.stock.updateMany({
        where: {
          productCode,
          allocatedQty: { lte: retry.qty - take },
          qty: { equals: retry.qty },
        },
        data: { allocatedQty: { increment: take } },
      });
      if (updated.count === 0) return 0;
    }

    // Allocation upsert（同一 orderId×productCode は加算）
    const existing = await tx.allocation.findUnique({
      where: { orderId_productCode: { orderId, productCode } },
    });
    if (existing) {
      await tx.allocation.update({
        where: { id: existing.id },
        data: { qty: { increment: take } },
      });
    } else {
      await tx.allocation.create({
        data: {
          orderId,
          pkNo,
          productCode,
          qty: take,
          status: 'reserved',
          source: 'made_to_order',
        },
      });
    }

    await tx.stockMovement.create({
      data: {
        productCode,
        type: 'outbound',
        qtyDelta: -take,
        refType: 'order_inspection',
        refId: pkNo,
        note: `検品時引当(MTO) ${pkNo}`,
      },
    });

    return take;
  });
}
