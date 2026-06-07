/**
 * GET /api/orders/[pkNo]
 * 出荷指示詳細（ピッキング№で検索）
 *
 * 権限:
 *   admin / manager — 全件アクセス可
 *   staff — 以下のいずれかを満たす伝票のみアクセス可（IDOR 対策）
 *     a) status='pending'（誰でも検品可能なキュー上の伝票）
 *     b) 自分が検品セッションを持っている伝票
 *     c) 論理削除済み伝票（キャンセル警告表示のため、読み取りのみ許可）
 *     d) status='held'（保留中：誰でも引き継ぎ可能。読取で内容確認 → 引き継ぎ判断）
 *     e) status='inspecting'（別担当者中：引き継ぎ確認モーダルに必要な情報の読取のみ）
 *
 * 2026-05-22: キャンセル伝票（deletedAt != null）も返却する。
 *   ハンディ/タブレット側で「キャンセル伝票です」赤背景モーダルを前面表示するため。
 *   レスポンスに `deleted: boolean` を含める（後方互換のため既存フィールドは維持）。
 * 2026-05-31: 引き継ぎ可能化（現場要望）。
 *   held / inspecting でも staff に読取を許可（実際の操作は /api/inspect/start の
 *   takeover フローで明示確認後に許可される）。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, resolveActor } from '@/lib/auth/permissions';

export async function GET(
  _req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const pkNo = decodeURIComponent(params.pkNo);
  // 論理削除済みも対象に含める（キャンセル伝票の警告表示用）。
  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo },
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
          staff: { select: { code: true, name: true } },
          device: { select: { code: true, name: true, type: true, location: true } },
        },
      },
      // Sprint Z-1: 引当行を含める（明細表に表示）
      allocations: {
        select: {
          productCode: true,
          qty: true,
          status: true,
          source: true,
          allocatedAt: true,
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

  const isDeleted = order.deletedAt != null;

  // staff 権限の場合は IDOR 防止: 自分が関与しない伝票へのアクセスは制限する。
  // ただし以下は許可:
  //   - pending（未着手）はキューとして誰でも見えてよい
  //   - キャンセル伝票（deleted=true）は「キャンセル警告」表示のため
  //   - 2026-05-31: held / inspecting も読取可（引き継ぎ確認用）。
  //     実際の検品操作（scan/hold/complete）は ownsSession で個別に防御されているので
  //     ここで読取を許しても変更系の IDOR は発生しない。
  if (guard.auth.role === 'staff' && !isDeleted) {
    const isPending = order.status === 'pending';
    const isHeld = order.status === 'held';
    const isInspecting = order.status === 'inspecting';
    const isOwnSession =
      order.inspSession?.staffCode != null &&
      order.inspSession.staffCode === guard.auth.staffCode;
    if (!isPending && !isHeld && !isInspecting && !isOwnSession) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: 'この伝票はアクセスできません' },
        { status: 403 },
      );
    }
  }

  return NextResponse.json({
    data: { ...order, deleted: isDeleted },
    message: 'OK',
  });
}

/**
 * DELETE /api/orders/[pkNo]
 * 伝票の論理削除（admin/manager のみ）
 *
 * 処理:
 *  1. status='inspecting' の場合は 409（保留→削除に誘導）
 *  2. deleted_at = NOW(), deleted_by = currentUser, delete_reason = reason をセット
 *  3. order_audit_logs に action='delete' で before/after を記録
 */

const DeleteBody = z.object({
  reason: z.string().min(1, '削除理由は必須です'),
});

export async function DELETE(
  req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = DeleteBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const pkNo = decodeURIComponent(params.pkNo);
  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: null },
    select: { id: true, pkNo: true, status: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'ピッキング№が見つかりません（または既に削除済み）' },
      { status: 404 },
    );
  }

  if (order.status === 'inspecting') {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: '検品中の伝票は削除できません。先に保留にしてから削除してください',
      },
      { status: 409 },
    );
  }

  const staffCode = resolveActor(guard.auth);
  if (!staffCode) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '監査ログ書込のため staff にリンクされたアカウントが必要です' },
      { status: 403 },
    );
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.shippingOrder.update({
      where: { id: order.id },
      data: {
        deletedAt: now,
        deletedBy: staffCode,
        deleteReason: parsed.data.reason,
      },
    }),
    prisma.orderAuditLog.create({
      data: {
        orderId: order.id,
        pkNo: order.pkNo,
        action: 'delete',
        actedBy: staffCode,
        reason: parsed.data.reason,
        diff: {
          before: { deletedAt: null, status: order.status },
          after: { deletedAt: now.toISOString(), deletedBy: staffCode },
        },
      },
    }),
  ]);

  return NextResponse.json({
    data: { pkNo: order.pkNo, deletedAt: now.toISOString() },
    message: 'OK',
  });
}
