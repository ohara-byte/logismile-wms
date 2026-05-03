import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffCode: z.string().min(1).max(10),
  patternCode: z.string().min(1).max(10),
  startTime: z.string().max(5).nullable().optional(),
  endTime: z.string().max(5).nullable().optional(),
  source: z.enum(['manual', 'gp_csv', 'auto']).default('manual'),
  note: z.string().nullable().optional(),
});

export async function PUT(
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
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }
  try {
    const updated = await prisma.shift.update({
      where: { id },
      data: {
        date: new Date(parsed.data.date),
        staffCode: parsed.data.staffCode,
        patternCode: parsed.data.patternCode,
        startTime: parsed.data.startTime ?? null,
        endTime: parsed.data.endTime ?? null,
        source: parsed.data.source,
        note: parsed.data.note ?? null,
      },
    });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'シフトが見つかりません' },
      { status: 404 },
    );
  }
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
  try {
    await prisma.shift.delete({ where: { id } });
    return NextResponse.json({ data: { id }, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `削除できません: ${e}` },
      { status: 409 },
    );
  }
}
