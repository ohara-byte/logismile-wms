/**
 * 出荷指示アクセス制御 共通ヘルパー（Sprint B-1 / IDOR 抑止）
 *
 * staff ロールが他人の検品セッションを覗けないように、
 * 「pending 状態の伝票（誰でも検品可能なキュー）」または
 * 「自分が検品セッションを持っている伝票」のみアクセス可とする。
 *
 * /api/orders/[pkNo]/timeline, /api/orders/[pkNo]/accompanies,
 * /api/master/boxes/suggest など複数 API で共通利用。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import type { AuthInfo } from './permissions';

interface OrderForAccess {
  status: string;
  inspSession: { staffCode: string } | null;
}

/**
 * staff の IDOR 制限。
 * admin / manager は何もしない（全件アクセス可）。
 * staff は pending または 自セッション 以外は 403。
 *
 * @returns ok=true のときアクセス許可、ok=false のときは response を直接返す
 */
export function assertOrderAccessByStaff(
  auth: AuthInfo,
  order: OrderForAccess,
):
  | { ok: true }
  | { ok: false; response: ReturnType<typeof NextResponse.json> } {
  if (auth.role === 'admin' || auth.role === 'manager') return { ok: true };

  const isPending = order.status === 'pending';
  const isOwn =
    order.inspSession?.staffCode != null &&
    order.inspSession.staffCode === auth.staffCode;

  if (isPending || isOwn) return { ok: true };

  return {
    ok: false,
    response: NextResponse.json(
      { error: 'FORBIDDEN', message: '他の担当者が検品中の伝票です' },
      { status: 403 },
    ),
  };
}

/**
 * pkNo を引数に取り、order の存在 + staff IDOR チェックを一括実行。
 * 見つからなければ 404、staff で他人の検品中なら 403、OK なら order を返す。
 */
export async function loadOrderForStaffAccess(
  auth: AuthInfo,
  pkNo: string,
): Promise<
  | { ok: true; orderId: string }
  | { ok: false; response: ReturnType<typeof NextResponse.json> }
> {
  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: null },
    select: {
      id: true,
      status: true,
      inspSession: { select: { staffCode: true } },
    },
  });
  if (!order) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'NOT_FOUND', message: 'ピッキング№が見つかりません' },
        { status: 404 },
      ),
    };
  }
  const access = assertOrderAccessByStaff(auth, order);
  if (!access.ok) return access;
  return { ok: true, orderId: order.id };
}
