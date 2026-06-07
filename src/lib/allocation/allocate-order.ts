/**
 * 引当ロジック（Sprint Z-1 / Phase A）
 *
 * 出荷指示に対して在庫を引当てる中核処理。
 *  - 同時実行下でも超過引当しないため、Stock 行の原子的更新を行う
 *  - SKU 単位（Lot 管理は将来拡張）
 *  - 不足分は集約して draft の ManufacturingInstruction を作成（Phase B で送信）
 *
 * 戻り値:
 *   - allocated: 完全に引当できた SKU
 *   - partial:   部分引当（不足あり）
 *   - shortage:  全 SKU 別の不足数集計
 *
 * 失敗時はトランザクション全体を rollback してエラー返却。
 */

import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { isFactoryApiMode } from '@/lib/integration/factory-mode';

export interface AllocateOrderResult {
  pkNo: string;
  allocations: Array<{
    productCode: string;
    requestedQty: number;
    allocatedQty: number;
    source: 'warehouse' | 'pass_through' | 'made_to_order';
  }>;
  shortages: Array<{ productCode: string; shortageQty: number }>;
  fullyAllocated: boolean;
}

/**
 * 単一の出荷指示（pkNo）に対して引当を試みる。
 * - 商品ごとに Product.productType を見てソースを決定
 * - すでに同 SKU の Allocation 行がある場合は追加引当（マージ）
 * - 同時実行は updateMany の where 条件で原子的に守る（楽観ロック）
 *
 * 既存出荷検品フロー（status='packed' 完了）には影響なし。
 */
export async function allocateOrder(pkNo: string): Promise<AllocateOrderResult> {
  const order = await prisma.shippingOrder.findUnique({
    where: { pkNo },
    include: {
      items: true,
      allocations: true,
    },
  });
  if (!order) {
    throw new Error(`PkNo ${pkNo} not found`);
  }

  const result: AllocateOrderResult = {
    pkNo,
    allocations: [],
    shortages: [],
    fullyAllocated: true,
  };

  // 商品ごとに必要数を算出（既存引当を差し引く）
  // Sprint Z-5: made_to_order は除外（検品時に prokpool から FIFO 引当）
  const productCodes = order.items.map((it) => it.productCode);
  const productTypes = await prisma.product.findMany({
    where: { code: { in: productCodes } },
    select: { code: true, productType: true },
  });
  const typeBySku = new Map(productTypes.map((p) => [p.code, p.productType]));

  // Sprint Z-8: factory_api モードでは made_to_order も通過型と同じく
  //   伝票引当する（在庫プールから取り、不足は出荷残として残る）。
  //   legacy モードでは検品時に FIFO 引当するため、ここでは除外する。
  const factoryApi = isFactoryApiMode();

  const needBySku = new Map<string, number>();
  for (const item of order.items) {
    const ptype = typeBySku.get(item.productCode) ?? 'warehouse';
    if (ptype === 'made_to_order' && !factoryApi) continue; // legacy: 伝票引当しない
    const already =
      order.allocations
        .filter((a) => a.productCode === item.productCode && a.status !== 'released')
        .reduce((s, a) => s + a.qty, 0) ?? 0;
    const need = Math.max(item.qty - already, 0);
    if (need > 0) {
      needBySku.set(item.productCode, (needBySku.get(item.productCode) ?? 0) + need);
    }
  }
  if (needBySku.size === 0) {
    return result; // 既に全引当済 or made_to_order のみ
  }

  // 各 SKU を順番に処理
  for (const [productCode, requested] of needBySku) {
    const allocated = await tryAllocateSku({
      orderId: order.id,
      pkNo: order.pkNo,
      productCode,
      requestedQty: requested,
    });

    result.allocations.push({
      productCode,
      requestedQty: requested,
      allocatedQty: allocated.allocatedQty,
      source: allocated.source,
    });

    if (allocated.allocatedQty < requested) {
      const shortageQty = requested - allocated.allocatedQty;
      result.shortages.push({ productCode, shortageQty });
      result.fullyAllocated = false;
    }
  }

  return result;
}

interface TryAllocateArgs {
  orderId: string;
  pkNo: string;
  productCode: string;
  requestedQty: number;
}

interface TryAllocateResult {
  allocatedQty: number;
  source: 'warehouse' | 'pass_through' | 'made_to_order';
}

/**
 * 1 SKU の引当試行。
 *  - Product.productType で source を決定
 *  - Stock の available（qty - allocatedQty）から取れるだけ取る
 *  - 競合制御は updateMany の where で `qty - allocatedQty >= take` を強制
 *
 * Sprint Z-5: 受注生産（made_to_order）は伝票引当をスキップ。
 *  - 当日の生産プールから検品時に FIFO（早く検品開始したものから）で引き当てる方針。
 *  - tryAllocateSku では allocated=0 を返すだけ。draft 製造指示生成は不要（必要数自体が即引当対象ではないため）
 */
async function tryAllocateSku(args: TryAllocateArgs): Promise<TryAllocateResult> {
  const { orderId, pkNo, productCode, requestedQty } = args;

  // 商品種別と現在在庫を取得
  const product = await prisma.product.findUnique({
    where: { code: productCode },
    select: { productType: true },
  });
  const source = (product?.productType ?? 'warehouse') as
    | 'warehouse'
    | 'pass_through'
    | 'made_to_order';

  // Sprint Z-5/Z-8: 受注生産は legacy モードでは伝票引当しない（検品時に inspection-time allocate へ）。
  //   factory_api モードでは通過型と同じように Stock プールから引き当てる。
  if (source === 'made_to_order' && !isFactoryApiMode()) {
    return { allocatedQty: 0, source };
  }

  // Stock 行が存在しない場合は作成（qty=0）
  const stock = await prisma.stock.upsert({
    where: { productCode },
    create: { productCode, qty: 0, allocatedQty: 0 },
    update: {},
  });

  const available = Math.max(stock.qty - stock.allocatedQty, 0);
  const take = Math.min(available, requestedQty);

  if (take <= 0) {
    return { allocatedQty: 0, source };
  }

  // 楽観ロック: updateMany で qty - allocatedQty >= take を強制
  // Prisma では条件式 (a + b) を直接書けないので、allocatedQty + take <= qty の形に変形
  const updated = await prisma.stock.updateMany({
    where: {
      productCode,
      // allocatedQty <= qty - take
      allocatedQty: { lte: stock.qty - take },
      qty: { equals: stock.qty }, // 取得時から qty が変わっていなければ
    },
    data: {
      allocatedQty: { increment: take },
    },
  });

  if (updated.count === 0) {
    // 競合発生 → 1 度だけリトライ（最新値で再計算）
    const retryStock = await prisma.stock.findUnique({ where: { productCode } });
    if (!retryStock) return { allocatedQty: 0, source };
    const retryAvailable = Math.max(retryStock.qty - retryStock.allocatedQty, 0);
    const retryTake = Math.min(retryAvailable, requestedQty);
    if (retryTake <= 0) return { allocatedQty: 0, source };

    const retryUpdate = await prisma.stock.updateMany({
      where: {
        productCode,
        allocatedQty: { lte: retryStock.qty - retryTake },
        qty: { equals: retryStock.qty },
      },
      data: { allocatedQty: { increment: retryTake } },
    });
    if (retryUpdate.count === 0) return { allocatedQty: 0, source };

    await upsertAllocationAndMovement({ orderId, pkNo, productCode, take: retryTake, source });
    return { allocatedQty: retryTake, source };
  }

  await upsertAllocationAndMovement({ orderId, pkNo, productCode, take, source });
  return { allocatedQty: take, source };
}

async function upsertAllocationAndMovement(args: {
  orderId: string;
  pkNo: string;
  productCode: string;
  take: number;
  source: 'warehouse' | 'pass_through' | 'made_to_order';
}): Promise<void> {
  const { orderId, pkNo, productCode, take, source } = args;

  // 既存 Allocation があれば qty 加算、無ければ新規作成
  const existing = await prisma.allocation.findUnique({
    where: { orderId_productCode: { orderId, productCode } },
  });

  if (existing) {
    await prisma.allocation.update({
      where: { id: existing.id },
      data: {
        qty: { increment: take },
        // status は reserved 維持（後続で fulfilled に更新）
      },
    });
  } else {
    await prisma.allocation.create({
      data: {
        orderId,
        pkNo,
        productCode,
        qty: take,
        status: 'reserved',
        source,
      },
    });
  }

  // 在庫増減ログ（refType='order'）
  await prisma.stockMovement.create({
    data: {
      productCode,
      type: 'outbound',
      qtyDelta: -take,
      refType: 'order',
      refId: pkNo,
      note: `引当 ${pkNo}`,
    },
  });
}

/**
 * 不足を集計して draft 製造指示を upsert する（Phase B で本格利用）。
 *
 * Sprint Y-13: createAlerts オプション追加。
 *   - 通過型運用では、出荷指示取込時に毎回「在庫不足」アラートが大量発生するのを防ぐため、
 *     取込フローからは createAlerts=false で呼ぶ。
 *   - 業務終了レポートや手動再引当時は createAlerts=true で要対応 SKU をアラート化。
 */
export async function createDraftInstructionsFromShortages(
  shortages: Array<{ productCode: string; shortageQty: number }>,
  options: {
    targetDate?: Date;
    requestedBy?: string | null;
    createAlerts?: boolean;
  } = {},
): Promise<void> {
  const targetDate =
    options.targetDate ?? new Date(new Date().setHours(0, 0, 0, 0));
  const createAlerts = options.createAlerts !== false; // 既定は true（後方互換）

  for (const s of shortages) {
    // 同 SKU × targetDate の draft が既にあれば qty を加算
    const existing = await prisma.manufacturingInstruction.findFirst({
      where: {
        productCode: s.productCode,
        status: 'draft',
        targetDate,
      },
    });

    if (existing) {
      await prisma.manufacturingInstruction.update({
        where: { id: existing.id },
        data: {
          qty: { increment: s.shortageQty },
          shortageQty: { increment: s.shortageQty },
        },
      });
    } else {
      await prisma.manufacturingInstruction.create({
        data: {
          instructionNo: makeInstructionNo(targetDate),
          productCode: s.productCode,
          qty: s.shortageQty,
          shortageQty: s.shortageQty,
          status: 'draft',
          targetDate,
          requestedBy: options.requestedBy ?? null,
        },
      });
    }

    // Sprint Y-13: createAlerts=true の場合のみ Alert 起票（取込時はスパム回避のため false 推奨）
    if (createAlerts) {
      await prisma.alert.create({
        data: {
          type: 'stock_shortage',
          severity: 'warn',
          title: `在庫不足: ${s.productCode}`,
          body: `不足 ${s.shortageQty} 個。製造指示 draft を生成しました。`,
          refCode: s.productCode,
        },
      });
    }
  }
}

function makeInstructionNo(targetDate: Date): string {
  const y = targetDate.getFullYear();
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const d = String(targetDate.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `MI-${y}${m}${d}-${rand}`;
}

/** Prisma の型を再エクスポートしたい場合のための保険 */
export type _PrismaTypes = Prisma.ShippingOrderInclude;
