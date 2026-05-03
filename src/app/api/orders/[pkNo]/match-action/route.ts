/**
 * POST /api/orders/[pkNo]/match-action
 * 未検品照合タブの mtoa-modal アクション実行（A-12）
 *
 * リクエスト: { action, reason }
 *   action: 'complete' | 'carry' | 'cancel' | 'reprint' | 'note'
 *   reason: 必須（cancel / carry / note では特に重要）
 *
 * 副作用:
 *   complete : status='packed' に強制更新（検品済 + 強制完了アラート）
 *   carry    : shipDate を翌日に変更（伝票No末尾は CR にしないが audit に記録）
 *   cancel   : DELETE と同等（論理削除）
 *   reprint  : print_logs に reprint=true で記録（実 IF は将来）
 *   note     : order_audit_logs にアクション='note' で記録
 *
 * すべて order_audit_logs に追記する。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  action: z.enum(['complete', 'carry', 'cancel', 'reprint', 'note']),
  reason: z.string().min(1, '理由は必須です').max(500),
});

export async function POST(
  req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }
  const { action, reason } = parsed.data;

  const pkNo = decodeURIComponent(params.pkNo);
  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo },
    select: {
      id: true,
      pkNo: true,
      status: true,
      shipDate: true,
      deletedAt: true,
    },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'ピッキング№が見つかりません' },
      { status: 404 },
    );
  }
  if (order.deletedAt && action !== 'note') {
    return NextResponse.json(
      { error: 'CONFLICT', message: '既に削除済みの伝票です' },
      { status: 409 },
    );
  }

  const now = new Date();
  const actor = guard.auth.staffCode ?? guard.auth.email ?? 'unknown';

  switch (action) {
    case 'complete':
      await prisma.$transaction([
        prisma.shippingOrder.update({
          where: { id: order.id },
          data: { status: 'packed' },
        }),
        prisma.orderAuditLog.create({
          data: {
            orderId: order.id,
            pkNo: order.pkNo,
            action: 'force_complete',
            actedBy: actor,
            reason,
            diff: { before: { status: order.status }, after: { status: 'packed' } },
          },
        }),
        prisma.alert.create({
          data: {
            type: 'force_complete',
            severity: 'warn',
            title: `強制完了: ${order.pkNo}`,
            body: `理由: ${reason}`,
            refCode: order.pkNo,
          },
        }),
      ]);
      break;

    case 'carry': {
      const next = new Date(order.shipDate);
      next.setDate(next.getDate() + 1);
      await prisma.$transaction([
        prisma.shippingOrder.update({
          where: { id: order.id },
          data: { shipDate: next, matchStatus: 'none', matchedAt: null, matchedBy: null },
        }),
        prisma.orderAuditLog.create({
          data: {
            orderId: order.id,
            pkNo: order.pkNo,
            action: 'carryover',
            actedBy: actor,
            reason,
            diff: {
              before: { shipDate: order.shipDate.toISOString() },
              after: { shipDate: next.toISOString() },
            },
          },
        }),
      ]);
      break;
    }

    case 'cancel':
      await prisma.$transaction([
        prisma.shippingOrder.update({
          where: { id: order.id },
          data: { deletedAt: now, deletedBy: actor, deleteReason: reason },
        }),
        prisma.orderAuditLog.create({
          data: {
            orderId: order.id,
            pkNo: order.pkNo,
            action: 'cancel',
            actedBy: actor,
            reason,
            diff: { before: { deletedAt: null }, after: { deletedAt: now.toISOString() } },
          },
        }),
      ]);
      break;

    case 'reprint':
      // print_logs への直接書込は将来 IF 接続時に実装。現状は audit のみ。
      await prisma.orderAuditLog.create({
        data: {
          orderId: order.id,
          pkNo: order.pkNo,
          action: 'picking_reprint',
          actedBy: actor,
          reason,
        },
      });
      break;

    case 'note':
      await prisma.orderAuditLog.create({
        data: {
          orderId: order.id,
          pkNo: order.pkNo,
          action: 'note',
          actedBy: actor,
          reason,
        },
      });
      break;
  }

  return NextResponse.json({
    data: { pkNo: order.pkNo, action, reason },
    message: 'OK',
  });
}
