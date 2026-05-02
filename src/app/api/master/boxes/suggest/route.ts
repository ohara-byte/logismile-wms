/**
 * GET /api/master/boxes/suggest
 * 箱候補提案（簡易版）
 *
 * クエリ:
 *  - pkNo（必須）: 出荷指示のピッキング№
 *
 * 簡易ロジック（Phase 6 で精緻化予定）:
 *  1. 注文に冷凍商品があれば frozen=true の箱から優先
 *  2. set_comps に固定箱があればそれを最優先
 *  3. なければ可変箱から、商品個数 ≥ 3 で sizeRank 80、それ以外は 60 を提案
 *
 * box-selector.ts として切り出すと Phase 6 のテストに流用しやすい。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const pkNo = searchParams.get('pkNo');
  if (!pkNo) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'pkNo は必須です' },
      { status: 422 },
    );
  }

  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: null },
    select: {
      items: {
        select: {
          qty: true,
          productCode: true,
          product: { select: { frozen: true, special: true } },
        },
      },
    },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: `ピッキング№が見つかりません: ${pkNo}` },
      { status: 404 },
    );
  }

  const totalQty = order.items.reduce((s, i) => s + i.qty, 0);
  const hasFrozen = order.items.some((i) => i.product.frozen);

  // ① 親商品から固定箱を逆引き
  const itemCodes = order.items.map((i) => i.productCode);
  let fixed: { code: string; name: string; sizeRank: number } | null = null;
  if (itemCodes.length > 0) {
    const setComp = await prisma.setComp.findFirst({
      where: {
        fixedBoxCode: { not: null },
        children: { some: { childCode: { in: itemCodes } } },
      },
      include: { fixedBox: { select: { code: true, name: true, sizeRank: true } } },
    });
    if (setComp?.fixedBox) fixed = setComp.fixedBox;
  }

  // ② 候補リスト（冷凍 / 可変）
  const variableBoxes = await prisma.box.findMany({
    where: {
      type: hasFrozen ? 'fixed' : 'variable',
      ...(hasFrozen ? { frozen: true } : {}),
    },
    orderBy: [{ priority: 'asc' }, { sizeRank: 'asc' }],
    select: { code: true, name: true, sizeRank: true, type: true, frozen: true },
  });

  // ③ おすすめ：商品個数で sizeRank 推定
  const targetRank = totalQty >= 5 ? 100 : totalQty >= 3 ? 80 : 60;
  const recommended =
    fixed ??
    variableBoxes.find((b) => b.sizeRank === targetRank) ??
    variableBoxes[0] ??
    null;

  return NextResponse.json({
    data: {
      recommended,
      candidates: fixed ? [fixed, ...variableBoxes] : variableBoxes,
      reasoning: {
        totalQty,
        hasFrozen,
        targetRank,
        usedFixed: !!fixed,
      },
    },
    message: 'OK',
  });
}
