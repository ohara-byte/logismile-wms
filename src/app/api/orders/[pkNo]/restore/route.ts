/**
 * POST /api/orders/[pkNo]/restore
 * 削除伝票の復活（admin/manager のみ）
 *
 * 処理:
 *  1. deleted_at != null の伝票のみ対象
 *  2. deleted_at / deleted_by / delete_reason を NULL に
 *  3. order_audit_logs に action='restore' で記録
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  reason: z.string().min(1, '復活理由は必須です'),
});

export async function POST(
  req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const pkNo = decodeURIComponent(params.pkNo);
  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: { not: null } },
    select: {
      id: true,
      pkNo: true,
      deletedAt: true,
      deletedBy: true,
      deleteReason: true,
    },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: '削除済みの該当伝票が見つかりません' },
      { status: 404 },
    );
  }

  const staffCode = guard.auth.staffCode;
  if (!staffCode) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '監査ログ書込のため staffCode が必要です' },
      { status: 403 },
    );
  }

  await prisma.$transaction([
    prisma.shippingOrder.update({
      where: { id: order.id },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    }),
    prisma.orderAuditLog.create({
      data: {
        orderId: order.id,
        pkNo: order.pkNo,
        action: 'restore',
        actedBy: staffCode,
        reason: parsed.data.reason,
        diff: {
          before: {
            deletedAt: order.deletedAt?.toISOString(),
            deletedBy: order.deletedBy,
            deleteReason: order.deleteReason,
          },
          after: { deletedAt: null, deletedBy: null, deleteReason: null },
        },
      },
    }),
  ]);

  return NextResponse.json({ data: { pkNo: order.pkNo }, message: 'OK' });
}
