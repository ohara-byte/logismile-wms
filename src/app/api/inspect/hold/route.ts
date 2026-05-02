/**
 * POST /api/inspect/hold
 * 検品保留（後で再開）
 *
 * 処理:
 *  - shipping_orders.status = 'held', hold_reason = reason
 *  - insp_logs に type=hold で記録
 *  - セッション自体は残す（完了はしない）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, ownsSession } from '@/lib/auth/permissions';

const Body = z.object({
  sessionId: z.string().min(1),
  reason: z.string().min(1),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const session = await prisma.inspSession.findUnique({
    where: { id: parsed.data.sessionId },
    select: { id: true, orderId: true, staffCode: true, completedAt: true },
  });
  if (!session || session.completedAt) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'セッションがないか既に完了しています' },
      { status: 404 },
    );
  }
  if (!ownsSession(guard.auth, session)) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '他の担当者のセッションは操作できません' },
      { status: 403 },
    );
  }

  await prisma.$transaction([
    prisma.shippingOrder.update({
      where: { id: session.orderId },
      data: { status: 'held', holdReason: parsed.data.reason },
    }),
    prisma.inspLog.create({
      data: {
        sessionId: session.id,
        type: 'hold',
        note: parsed.data.reason,
      },
    }),
  ]);

  return NextResponse.json({ data: { sessionId: session.id }, message: 'OK' });
}
