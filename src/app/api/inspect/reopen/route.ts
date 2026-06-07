/**
 * POST /api/inspect/reopen
 * 検品戻し（packed → inspecting に戻して再検品可能にする）
 *
 * モック準拠（タブレット検品モック_v0.18.html L1547 reopenCompletedOrder）
 *
 * リクエスト: { pkNo, reason? }
 *
 * 処理:
 *  1. 該当伝票を取得（packed/shipped 必須）
 *  2. status を 'inspecting' に戻す
 *  3. order_audit_logs に action='reopen' で記録
 *  4. 関連 inspSession の completedAt を null に戻す
 *
 * 認証: admin / manager / staff（現場端末から戻すケースを想定）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, resolveActor } from '@/lib/auth/permissions';

const Body = z.object({
  pkNo: z.string().min(1),
  reason: z.string().min(1).max(500).optional(),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo: parsed.data.pkNo, deletedAt: null },
    include: { inspSession: { select: { id: true, completedAt: true } } },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'ピッキング№が見つかりません' },
      { status: 404 },
    );
  }
  if (order.status !== 'packed' && order.status !== 'shipped') {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `この伝票は完了済みではありません（status=${order.status}）`,
      },
      { status: 409 },
    );
  }

  // 2026-06-01 A-1: order_audit_logs.acted_by は staff.code FK(VarChar10)。
  //   email/'unknown' を入れると FK 違反/桁あふれで 500 になるため、
  //   有効な staffCode が無ければ 403 で弾く（PC ユーザーは staff リンク必須）。
  const actor = resolveActor(guard.auth);
  if (!actor) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '監査ログ記録のため staff にリンクされたアカウントが必要です' },
      { status: 403 },
    );
  }
  const now = new Date();

  const ops: Promise<unknown>[] = [
    prisma.shippingOrder.update({
      where: { id: order.id },
      data: { status: 'inspecting' },
    }),
    prisma.orderAuditLog.create({
      data: {
        orderId: order.id,
        pkNo: order.pkNo,
        action: 'reopen',
        actedBy: actor,
        reason: parsed.data.reason ?? '検品戻し（再検品）',
        diff: {
          before: { status: order.status },
          after: { status: 'inspecting' },
        },
      },
    }),
  ];
  if (order.inspSession?.id && order.inspSession.completedAt) {
    ops.push(
      prisma.inspSession.update({
        where: { id: order.inspSession.id },
        data: { completedAt: null },
      }),
    );
  }
  await prisma.$transaction(
    ops as unknown as Parameters<typeof prisma.$transaction>[0],
  );

  return NextResponse.json({
    data: { pkNo: order.pkNo, before: order.status, after: 'inspecting' },
    message: 'OK',
    sentAt: now.toISOString(),
  });
}
