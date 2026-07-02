/**
 * POST /api/allocation/pullback?date=YYYY-MM-DD&productType=pass_through
 *
 * Sprint Z-4: 引き戻し（pull back）処理。
 *  - 通過型 SKU に対する reserved 引当を release し、Stock.allocatedQty を解放
 *  - 出荷照合で残検出時に運用者が任意のタイミングで実行する想定
 *  - status='reserved' の Allocation のみ対象。fulfilled は触らない
 *  - StockMovement(type='adjust', refType='pullback') を記録
 *
 * クエリ:
 *  - date: 対象日（出荷指示の shipDate）
 *  - productType: 既定 'pass_through'。'all' で全種別対象
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';
import { parseDateAsUTC, addDaysUTC, todayJstAsUTC } from '@/lib/date-utils';

const Query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productType: z
    .enum(['pass_through', 'warehouse', 'made_to_order', 'all'])
    .default('pass_through'),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const parsed = Query.safeParse({
    date: searchParams.get('date'),
    productType: (searchParams.get('productType') ?? 'pass_through') as string,
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

  // 日付根治(2026-07-02): @db.Date と一致する UTC 真夜中で当日範囲を作る。
  const targetDate = parseDateAsUTC(parsed.data.date) ?? todayJstAsUTC();
  const nextDate = addDaysUTC(targetDate, 1);

  try {
    // 対象 productCode を絞る（Allocation は Product への直接リレーションを持たないため、先に Product 一覧を取得）
    let productCodeFilter: string[] | undefined;
    if (parsed.data.productType !== 'all') {
      const products = await prisma.product.findMany({
        where: { productType: parsed.data.productType },
        select: { code: true },
      });
      productCodeFilter = products.map((p) => p.code);
      if (productCodeFilter.length === 0) {
        return NextResponse.json({
          data: { skuCount: 0, releasedCount: 0, releasedQty: 0 },
          message: '対象商品がありません',
        });
      }
    }

    const targets = await prisma.allocation.findMany({
      where: {
        status: 'reserved',
        order: {
          deletedAt: null,
          shipDate: { gte: targetDate, lt: nextDate },
        },
        ...(productCodeFilter ? { productCode: { in: productCodeFilter } } : {}),
      },
    });

    if (targets.length === 0) {
      return NextResponse.json({
        data: { skuCount: 0, releasedCount: 0, releasedQty: 0 },
        message: '対象がありません',
      });
    }

    // SKU 単位で qty を集計
    const qtyBySku = new Map<string, number>();
    for (const a of targets) {
      qtyBySku.set(a.productCode, (qtyBySku.get(a.productCode) ?? 0) + a.qty);
    }

    // トランザクション: Allocation.status='released' / Stock.allocatedQty -= 解放数 / StockMovement 記録
    const result = await prisma.$transaction(async (tx) => {
      // 1) Allocation を一括 release
      const ids = targets.map((a) => a.id);
      const updated = await tx.allocation.updateMany({
        where: { id: { in: ids } },
        data: { status: 'released' },
      });

      // 2) Stock.allocatedQty を SKU 単位で減らす（負にならないようガード）
      for (const [productCode, qty] of qtyBySku) {
        await tx.stock.updateMany({
          where: {
            productCode,
            allocatedQty: { gte: qty },
          },
          data: {
            allocatedQty: { decrement: qty },
          },
        });

        // 3) 在庫変動ログ（adjust, refType='pullback'）
        await tx.stockMovement.create({
          data: {
            productCode,
            type: 'adjust',
            qtyDelta: 0, // qty 自体は変わらない（allocatedQty のみ）
            refType: 'pullback',
            refId: parsed.data.date,
            createdBy: guard.auth.staffCode ?? null,
            note: `引き戻し: 引当解放 ${qty} 個（${parsed.data.date}）`,
          },
        });
      }

      const totalQty = Array.from(qtyBySku.values()).reduce(
        (s, q) => s + q,
        0,
      );

      return {
        skuCount: qtyBySku.size,
        releasedCount: updated.count,
        releasedQty: totalQty,
      };
    });

    return NextResponse.json({ data: result, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/allocation/pullback]',
      e,
      'CONFLICT',
      409,
      '引き戻しに失敗しました',
    );
  }
}
