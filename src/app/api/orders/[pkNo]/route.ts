/**
 * GET /api/orders/[pkNo]
 * 出荷指示詳細（ピッキング№で検索）
 *
 * 権限:
 *   admin / manager — 全件アクセス可
 *   staff — 以下のいずれかを満たす伝票のみアクセス可（IDOR 対策）
 *     a) status='pending'（誰でも検品可能なキュー上の伝票）
 *     b) 自分が検品セッションを持っている伝票
 *
 * 論理削除されたものは返さない（deleted_at IS NULL）。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(
  _req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const pkNo = decodeURIComponent(params.pkNo);
  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: null },
    include: {
      carrier: { select: { code: true, name: true, short: true, cool: true } },
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          product: { select: { code: true, name: true, jan: true, frozen: true, special: true } },
        },
      },
      inspSession: {
        select: {
          id: true,
          staffCode: true,
          deviceCode: true,
          startedAt: true,
          completedAt: true,
          boxCode: true,
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'ピッキング№が見つかりません' },
      { status: 404 },
    );
  }

  // staff 権限の場合は IDOR 防止: 自分が関与しない伝票へのアクセスは制限する。
  // ただし pending（未着手）はキューとして誰でも見えてよい（検品開始の起点）。
  if (guard.auth.role === 'staff') {
    const isPending = order.status === 'pending';
    const isOwnSession =
      order.inspSession?.staffCode != null &&
      order.inspSession.staffCode === guard.auth.staffCode;
    if (!isPending && !isOwnSession) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: '他の担当者が検品中の伝票です' },
        { status: 403 },
      );
    }
  }

  return NextResponse.json({ data: order, message: 'OK' });
}
