import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  parentCode: z.string().min(1).max(20),
  parentName: z.string().min(1).max(100),
  type: z.enum(['set', 'koudoku', 'noshi', 'other']).default('set'),
  fixedBoxCode: z.string().max(30).nullable().optional(),
  packingNote: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
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
  const id = decodeURIComponent(params.id);
  try {
    const updated = await prisma.setComp.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'IDが見つかりません' },
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
  const id = decodeURIComponent(params.id);
  try {
    await prisma.setComp.delete({ where: { id } });
    return NextResponse.json({ data: { id }, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `削除できません: ${e}` },
      { status: 409 },
    );
  }
}
