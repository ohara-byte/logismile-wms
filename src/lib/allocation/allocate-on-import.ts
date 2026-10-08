/**
 * 出荷指示の取込直後の自動引当（Sprint Z-1・2026-10-08 に orders/import/route.ts から切り出し）。
 *
 * CSV 取込（POST /api/orders/import）と HUB 取込（POST /api/integration/hub/orders）で**同じ後処理**を
 * 行うために 1 か所に置く（ADR-030「受信側の期待を正」：経路で動きを変えない）。
 *
 *   - 取込結果に影響しないよう、例外はすべて握り潰して警告ログだけ残す
 *   - その取込で入った伝票（論理削除済みを除く）に対して allocateOrder を順に試行
 *   - 不足は draft の ManufacturingInstruction として集約（人手レビュー後に送信）
 *   - Sprint Y-13: 取込時はアラートを生成しない（通過型運用で大量に出る不足は想定内のため）
 */

import { prisma } from '@/lib/db';
import { allocateOrder, createDraftInstructionsFromShortages } from './allocate-order';

export async function allocateImportedOrders(importId: number | undefined, requestedBy: string | null): Promise<void> {
  const importedPkNos = await prisma.shippingOrder
    .findMany({
      where: { importId, deletedAt: null },
      select: { pkNo: true },
    })
    .catch(() => [] as Array<{ pkNo: string }>);

  // 並列上限を抑えて順次処理（在庫競合の可能性を下げる）
  const allShortages: Array<{ productCode: string; shortageQty: number }> = [];
  for (const { pkNo } of importedPkNos) {
    try {
      const r = await allocateOrder(pkNo);
      for (const s of r.shortages) {
        const existing = allShortages.find((x) => x.productCode === s.productCode);
        if (existing) existing.shortageQty += s.shortageQty;
        else allShortages.push({ ...s });
      }
    } catch (e) {
      console.warn(`[allocate-on-import] ${pkNo}:`, e);
    }
  }

  if (allShortages.length > 0) {
    try {
      await createDraftInstructionsFromShortages(allShortages, { requestedBy, createAlerts: false });
    } catch (e) {
      console.warn('[allocate-on-import] draft instructions failed:', e);
    }
  }
}
