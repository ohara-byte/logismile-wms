/**
 * POST /api/settings/stock-recompute
 *
 * Sprint Z-5: Stock.allocatedQty を Allocation 集計から再計算。
 *  - drift 検出 + 修正（admin/manager 操作）
 *  - status='released' は除外（reserved + fulfilled が「実際に握られている量」）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

export async function POST() {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;

  try {
    // 全 Stock を対象に集計
    const stocks = await prisma.stock.findMany({
      select: { productCode: true, allocatedQty: true },
    });

    const allocAgg = await prisma.allocation.groupBy({
      by: ['productCode'],
      where: { status: { not: 'released' } },
      _sum: { qty: true },
    });
    const allocBySku = new Map<string, number>();
    for (const a of allocAgg) {
      allocBySku.set(a.productCode, a._sum.qty ?? 0);
    }

    const drifts: Array<{
      productCode: string;
      before: number;
      after: number;
      delta: number;
    }> = [];

    for (const s of stocks) {
      const computed = allocBySku.get(s.productCode) ?? 0;
      if (computed !== s.allocatedQty) {
        drifts.push({
          productCode: s.productCode,
          before: s.allocatedQty,
          after: computed,
          delta: computed - s.allocatedQty,
        });
      }
    }

    if (drifts.length === 0) {
      return NextResponse.json({
        data: { drifts: [], updated: 0 },
        message: '差分はありません',
      });
    }

    // 一括修正
    await prisma.$transaction(
      drifts.map((d) =>
        prisma.stock.update({
          where: { productCode: d.productCode },
          data: { allocatedQty: d.after },
        }),
      ),
    );

    // 監査用 StockMovement
    await prisma.stockMovement.createMany({
      data: drifts.map((d) => ({
        productCode: d.productCode,
        type: 'adjust' as const,
        qtyDelta: 0,
        refType: 'allocated_qty_recompute',
        refId: new Date().toISOString().slice(0, 10),
        createdBy: guard.auth.staffCode ?? null,
        note: `allocatedQty 再計算: ${d.before} → ${d.after}`,
      })),
    });

    return NextResponse.json({
      data: { drifts, updated: drifts.length },
      message: `${drifts.length} 件の SKU を修正しました`,
    });
  } catch (e) {
    return maskError(
      '[POST /api/settings/stock-recompute]',
      e,
      'CONFLICT',
      409,
      '再計算に失敗しました',
    );
  }
}
