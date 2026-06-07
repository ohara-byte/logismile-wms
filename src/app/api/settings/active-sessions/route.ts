/**
 * GET    /api/settings/active-sessions       — 未完了の検品セッション一覧
 * DELETE /api/settings/active-sessions       — { sessionId } で強制終了 (completedAt セット)
 *
 * Sprint Z-5: ハンディ/タブレットがフリーズした際の復旧用。
 *  - InspSession.completedAt をセットするだけ（ロックは解除されるが ShippingOrder.status は変えない）
 *  - 取消 reason を InspLog に記録
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET() {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;

  const sessions = await prisma.inspSession.findMany({
    where: { completedAt: null },
    orderBy: { startedAt: 'asc' },
    take: 200,
    include: {
      order: { select: { pkNo: true, destName: true, status: true } },
      staff: { select: { empCode: true, name: true } },
      device: { select: { code: true, location: true, type: true } },
    },
  });

  const now = Date.now();
  return NextResponse.json({
    data: {
      sessions: sessions.map((s) => ({
        id: s.id,
        pkNo: s.order.pkNo,
        destName: s.order.destName,
        orderStatus: s.order.status,
        staffCode: s.staff.empCode,
        staffName: s.staff.name,
        deviceCode: s.device?.code ?? null,
        deviceLocation: s.device?.location ?? null,
        deviceType: s.device?.type ?? null,
        startedAt: s.startedAt.toISOString(),
        elapsedMin: Math.floor((now - s.startedAt.getTime()) / 60000),
      })),
      total: sessions.length,
    },
    message: 'OK',
  });
}

const DelBody = z.object({
  sessionId: z.string().min(1),
  reason: z.string().min(1),
});

export async function DELETE(req: Request) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = DelBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: parsed.error.issues.map((i) => i.message).join(', '),
      },
      { status: 422 },
    );
  }

  const session = await prisma.inspSession.findUnique({
    where: { id: parsed.data.sessionId },
  });
  if (!session) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'セッションがありません' },
      { status: 404 },
    );
  }
  if (session.completedAt) {
    return NextResponse.json(
      { error: 'CONFLICT', message: '既に完了済のセッションです' },
      { status: 409 },
    );
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.inspSession.update({
      where: { id: session.id },
      data: {
        completedAt: now,
        durationSec: Math.max(
          1,
          Math.round((now.getTime() - session.startedAt.getTime()) / 1000),
        ),
      },
    }),
    prisma.inspLog.create({
      data: {
        sessionId: session.id,
        type: 'force_close',
        itemCode: null,
        note: `[admin force close by ${guard.auth.staffCode ?? '?'}] ${parsed.data.reason}`,
      },
    }),
  ]);

  return NextResponse.json({
    data: { sessionId: session.id },
    message: 'セッションを強制終了しました',
  });
}
