/**
 * POST /api/allocation/realloc?date=YYYY-MM-DD
 *
 * Sprint Z-2: 再引当（伝票処理順問題への対処）
 *  - 該当日の未出荷注文（pending / inspecting / held）の reserved Allocation をすべて release
 *  - そのうえで「優先度付きで」再引当を実行
 *      優先度: shipDate ASC → carrier.priority ASC → 冷凍便（frozen item を含む）優先 → createdAt ASC
 *  - 認証: admin / manager のみ
 *
 * 用途:
 *  - 取込順では引当が偏る場合に、業務優先度に沿って再分配
 *  - 検品中（inspecting）の Allocation も release するため、稼働時間中は注意
 *    （UI 側で「検品中 N 件あります、本当に再引当しますか？」と確認）
 *
 * 注意:
 *  - status='fulfilled'（出荷完了）は触らない
 *  - 削除済（deletedAt!=null）も対象外
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/auth/permissions';
import {
  allocateOrder,
  createDraftInstructionsFromShortages,
} from '@/lib/allocation/allocate-order';
import { parseDateAsUTC, addDaysUTC, todayJstAsUTC } from '@/lib/date-utils';

const Query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // 検品中の Allocation も release するか（既定 false）
  includeInspecting: z.boolean().optional(),
});

export async function POST(req: Request) {
  // Sprint Y-11: 再引当はマスタ操作相当として扱う
  const guard = await requirePermission('master_edit');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const parsed = Query.safeParse({
    date: searchParams.get('date'),
    includeInspecting: searchParams.get('includeInspecting') === 'true',
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

  // 対象出荷指示を「優先度順」で取得
  const orders = await prisma.shippingOrder.findMany({
    where: {
      deletedAt: null,
      shipDate: { gte: targetDate, lt: nextDate },
      status: parsed.data.includeInspecting
        ? { in: ['pending', 'inspecting', 'held'] }
        : { in: ['pending', 'held'] },
    },
    include: {
      carrier: { select: { priority: true } },
      items: {
        include: {
          product: { select: { frozen: true } },
        },
      },
    },
  });

  // 優先度ソート: shipDate ASC, carrier.priority ASC, frozenItem 優先, createdAt ASC
  orders.sort((a, b) => {
    const ad = a.shipDate.getTime();
    const bd = b.shipDate.getTime();
    if (ad !== bd) return ad - bd;
    const ap = a.carrier?.priority ?? 99;
    const bp = b.carrier?.priority ?? 99;
    if (ap !== bp) return ap - bp;
    const af = a.items.some((it) => it.product.frozen) ? 0 : 1;
    const bf = b.items.some((it) => it.product.frozen) ? 0 : 1;
    if (af !== bf) return af - bf;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const orderIds = orders.map((o) => o.id);

  // すべての reserved Allocation を release（検品中は判定済）
  await prisma.$transaction(async (tx) => {
    // release する Allocation を取得し、Stock.allocatedQty を一括減算
    const released = await tx.allocation.findMany({
      where: {
        orderId: { in: orderIds },
        status: 'reserved',
      },
      select: { id: true, productCode: true, qty: true },
    });

    // SKU ごとに合計を集計して Stock.allocatedQty を減算
    const totalBySku = new Map<string, number>();
    for (const a of released) {
      totalBySku.set(
        a.productCode,
        (totalBySku.get(a.productCode) ?? 0) + a.qty,
      );
    }
    for (const [productCode, qty] of totalBySku) {
      await tx.stock.updateMany({
        where: { productCode },
        data: { allocatedQty: { decrement: qty } },
      });
    }

    // Allocation を release
    if (released.length > 0) {
      await tx.allocation.updateMany({
        where: { id: { in: released.map((r) => r.id) } },
        data: { status: 'released' },
      });
    }
  });

  // 優先度順に再引当
  let allocatedCount = 0;
  const aggregateShortages: Array<{
    productCode: string;
    shortageQty: number;
  }> = [];
  for (const o of orders) {
    try {
      const r = await allocateOrder(o.pkNo);
      const sum = r.allocations.reduce((s, a) => s + a.allocatedQty, 0);
      if (sum > 0) allocatedCount++;
      for (const s of r.shortages) {
        const found = aggregateShortages.find(
          (x) => x.productCode === s.productCode,
        );
        if (found) found.shortageQty += s.shortageQty;
        else aggregateShortages.push({ ...s });
      }
    } catch (e) {
      console.warn(`[realloc] ${o.pkNo}:`, e);
    }
  }

  // 不足を draft 製造指示にまとめる
  let draftInstructions = 0;
  if (aggregateShortages.length > 0) {
    try {
      await createDraftInstructionsFromShortages(aggregateShortages, {
        targetDate,
        requestedBy: guard.auth.staffCode ?? null,
      });
      draftInstructions = aggregateShortages.length;
    } catch (e) {
      console.warn('[realloc] draft instructions failed:', e);
    }
  }

  return NextResponse.json({
    data: {
      targetDate: parsed.data.date,
      orderCount: orders.length,
      allocatedCount,
      shortageSkus: aggregateShortages.length,
      draftInstructions,
    },
    message: 'OK',
  });
}
