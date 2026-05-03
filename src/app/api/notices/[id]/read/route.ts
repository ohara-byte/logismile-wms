/**
 * PUT /api/notices/[id]/read
 * 着信（inbox）連絡を既読化する。
 *
 * 認証: admin / manager のみ（PC 操作）
 * 副作用: BadgeCounts.ann が即時減算される（次回 SSE で配信）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function PUT(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: '不正な ID' },
      { status: 422 },
    );
  }

  const notice = await prisma.notice.findUnique({
    where: { id },
    select: { id: true, kind: true, readAt: true },
  });
  if (!notice) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'notice が見つかりません' }, { status: 404 });
  }
  if (notice.kind !== 'inbox') {
    return NextResponse.json(
      { error: 'CONFLICT', message: 'inbox 種別のみ既読化できます' },
      { status: 409 },
    );
  }

  const updated = await prisma.notice.update({
    where: { id },
    data: {
      readAt: notice.readAt ?? new Date(),
      readBy: guard.auth.staffCode ?? null,
    },
  });

  return NextResponse.json({ data: updated, message: 'OK' });
}
