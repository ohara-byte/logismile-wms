/**
 * 在庫補充時の自動再引当（Sprint Z-8）
 *
 * 工場納品 → Stock.qty 増加 → このモジュールが該当 SKU を含む
 * 未引当 / 部分引当の出荷指示に対して優先度順で引当を再実行する。
 *
 * 優先度（既存の業務ルールと整合）：
 *   1. shipDate ASC（早い出荷日優先）
 *   2. carrier.priority ASC（運送会社 cutoff 順）
 *   3. createdAt ASC（取込順）
 *
 * 競合制御は allocate-order.ts と同じく Stock の楽観ロックに委ねる。
 */

import { prisma } from '@/lib/db';
import { allocateOrder } from './allocate-order';

export interface ReallocateResult {
  productCode: string;
  ordersTried: number;
  allocated: number;
  shortage: number;
}

/** 1 SKU 分の自動再引当。新たに引当できた数量と、未だ不足している数量を返す。 */
export async function reallocateForProduct(
  productCode: string,
): Promise<ReallocateResult> {
  // 該当 SKU を含む未完了出荷指示を優先度順に取得
  const orders = await prisma.shippingOrder.findMany({
    where: {
      deletedAt: null,
      status: { in: ['pending', 'inspecting', 'held'] },
      items: { some: { productCode } },
    },
    include: {
      items: { where: { productCode }, select: { qty: true } },
      allocations: { where: { productCode }, select: { qty: true, status: true } },
      carrier: { select: { priority: true } },
    },
    orderBy: [{ shipDate: 'asc' }, { createdAt: 'asc' }],
    take: 200,
  });

  // 運送会社 priority で 2 段ソート（同 shipDate 内）
  orders.sort((a, b) => {
    const ds = a.shipDate.getTime() - b.shipDate.getTime();
    if (ds !== 0) return ds;
    const ap = a.carrier?.priority ?? 999;
    const bp = b.carrier?.priority ?? 999;
    if (ap !== bp) return ap - bp;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  let allocated = 0;
  let shortage = 0;
  let tried = 0;
  for (const o of orders) {
    const requiredForSku = o.items.reduce((s, it) => s + it.qty, 0);
    const alreadyForSku = o.allocations
      .filter((a) => a.status !== 'released')
      .reduce((s, a) => s + a.qty, 0);
    if (alreadyForSku >= requiredForSku) continue; // 既に充足

    tried++;
    try {
      const r = await allocateOrder(o.pkNo);
      // 該当 SKU の結果を抽出
      const me = r.allocations.find((a) => a.productCode === productCode);
      if (me) allocated += me.allocatedQty;
      const sh = r.shortages.find((s) => s.productCode === productCode);
      if (sh) shortage += sh.shortageQty;
    } catch {
      // 個別失敗は無視して継続（業務影響を最小化）
    }
  }

  return { productCode, ordersTried: tried, allocated, shortage };
}
