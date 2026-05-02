/** PUT/DELETE /api/notices/[id] — 連絡事項の編集/論理削除（active=false） */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const PutBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  title: z.string().min(1).optional(),
  body: z.string().nullable().optional(),
  targetType: z.enum(['all', 'group', 'table']).optional(),
  targetId: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  active: z.boolean().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'VALIDATION', message: '不正な ID' }, { status: 422 });
  }

  const json = await req.json();
  const parsed = PutBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const data = parsed.data;
  const updated = await prisma.notice.update({
    where: { id },
    data: {
      ...(data.date ? { date: new Date(data.date) } : {}),
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.body !== undefined ? { body: data.body } : {}),
      ...(data.targetType ? { targetType: data.targetType } : {}),
      ...(data.targetId !== undefined ? { targetId: data.targetId } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
    },
  });

  return NextResponse.json({ data: updated, message: 'OK' });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'VALIDATION', message: '不正な ID' }, { status: 422 });
  }

  await prisma.notice.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ data: { id }, message: 'DEACTIVATED' });
}
