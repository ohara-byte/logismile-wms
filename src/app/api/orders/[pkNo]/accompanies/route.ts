/**
 * GET /api/orders/[pkNo]/accompanies
 * 同梱物リスト取得
 *
 * 仕様（CLAUDE.md §5 商品階層 / 設計メモ §8）:
 *  - 親商品は WMS に存在しない → set_comps から「逆引き」
 *  - order.items の child_code を含む set_comps を検索
 *  - 同梱物は set_comps.type='noshi'/'pamphlet'/'addon' のものを返す
 *  - 親が確定したらその set_comps の packing_note と固定箱コードも返す
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { assertOrderAccessByStaff } from '@/lib/auth/order-access';

export async function GET(
  _req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const pkNo = decodeURIComponent(params.pkNo);

  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: null },
    select: {
      id: true,
      status: true,
      items: { select: { productCode: true, qty: true } },
      noshiName: true,
      inspSession: { select: { staffCode: true } },
    },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: `ピッキング№が見つかりません: ${pkNo}` },
      { status: 404 },
    );
  }

  // staff IDOR 抑止（B-2 / H-2）
  const access = assertOrderAccessByStaff(guard.auth, {
    status: order.status,
    inspSession: order.inspSession,
  });
  if (!access.ok) return access.response;

  const itemCodes = order.items.map((i) => i.productCode);
  if (itemCodes.length === 0) {
    return NextResponse.json({ data: { setComp: null, accompanies: [] }, message: 'OK' });
  }

  // 子コードを含む set_comp を検索
  const candidates = await prisma.setComp.findMany({
    where: { children: { some: { childCode: { in: itemCodes } } } },
    include: { children: true, fixedBox: { select: { code: true, name: true, sizeRank: true } } },
  });

  // 完全一致 (構成商品が全部含まれる) を最優先、次に部分一致
  const itemCodeSet = new Set(itemCodes);
  const scored = candidates.map((c) => {
    const childCodes = new Set(c.children.map((ch) => ch.childCode));
    const overlap = c.children.filter((ch) => itemCodeSet.has(ch.childCode)).length;
    const exact = childCodes.size === overlap && itemCodes.length === overlap;
    return { setComp: c, overlap, exact };
  });
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || b.overlap - a.overlap);
  const best = scored[0]?.setComp ?? null;

  // 同梱物チェックリスト（最終チェックモーダルの ☑ 対象）。
  //   2026-06-23: 親商品セット本体（type='set'）は「確認すべき同梱物」ではないため除外する。
  //   基幹マスタ統合で全セットが set_comps に載った結果、検品完了時に
  //   セット本体が同梱物チェックとして毎回出て余分な工数になっていた不具合の解消。
  //   ※固定箱・梱包メモは下の setComp で別途返すため、表示自体は失われない。
  //   genuine な同梱物（のし/パンフ等の非set）が best になった場合のみチェック対象に含める。
  const accompanies: Array<{ id: string; type: string; name: string; packingNote: string | null }> =
    [];
  if (best && best.type !== 'set') {
    accompanies.push({
      id: best.id,
      type: best.type,
      name: best.parentName,
      packingNote: best.packingNote,
    });
  }
  if (order.noshiName) {
    accompanies.push({ id: 'noshi-from-order', type: 'noshi', name: order.noshiName, packingNote: null });
  }

  return NextResponse.json({
    data: {
      setComp: best
        ? {
            id: best.id,
            parentCode: best.parentCode,
            parentName: best.parentName,
            type: best.type,
            packingNote: best.packingNote,
            fixedBox: best.fixedBox,
          }
        : null,
      accompanies,
    },
    message: 'OK',
  });
}
