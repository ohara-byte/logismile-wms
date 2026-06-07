/**
 * PATCH  /api/mfg/[id]   — qty/note/status 編集（draft 専用 + status 'pending'<->'draft'）
 * DELETE /api/mfg/[id]   — 取消（status='cancelled' に倒す。物理削除しない）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const PatchBody = z.object({
  qty: z.number().int().min(1).optional(),
  note: z.string().nullable().optional(),
  status: z.enum(['draft', 'pending']).optional(),
  approved: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
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

  const json = await req.json().catch(() => ({}));
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: parsed.error.issues.map((i) => i.message).join(', '),
      },
      { status: 422 },
    );
  }

  const target = await prisma.manufacturingInstruction.findUnique({
    where: { id },
  });
  if (!target) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: '製造指示が見つかりません' },
      { status: 404 },
    );
  }
  // sent / completed / cancelled は編集不可（取消は DELETE で）
  if (target.status === 'sent' || target.status === 'completed' || target.status === 'cancelled') {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `status=${target.status} の指示は編集できません`,
      },
      { status: 409 },
    );
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.qty != null) {
    data.qty = parsed.data.qty;
  }
  if (parsed.data.note !== undefined) data.note = parsed.data.note;
  if (parsed.data.status) data.status = parsed.data.status;
  if (parsed.data.approved !== undefined) data.approved = parsed.data.approved;

  const updated = await prisma.manufacturingInstruction.update({
    where: { id },
    data,
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
    return NextResponse.json(
      { error: 'VALIDATION', message: '不正な ID' },
      { status: 422 },
    );
  }

  const target = await prisma.manufacturingInstruction.findUnique({
    where: { id },
  });
  if (!target) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: '製造指示が見つかりません' },
      { status: 404 },
    );
  }
  if (target.status === 'completed') {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: '完成済みの指示は取消できません',
      },
      { status: 409 },
    );
  }

  const updated = await prisma.manufacturingInstruction.update({
    where: { id },
    data: { status: 'cancelled' },
  });
  return NextResponse.json({ data: updated, message: 'OK' });
}
