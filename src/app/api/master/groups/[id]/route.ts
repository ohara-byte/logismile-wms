import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  name: z.string().min(1).max(20),
  tables: z.union([z.string(), z.array(z.string())]).optional(),
  category: z.string().min(1).max(20),
  needStaff: z.number().int().min(0).default(1),
  note: z.string().nullable().optional(),
});

function normalizeTables(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return v
    .split(/[,、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

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
    const updated = await prisma.inspectionGroup.update({
      where: { id },
      data: { ...parsed.data, tables: normalizeTables(parsed.data.tables) },
    });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'グループが見つかりません' },
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
    await prisma.inspectionGroup.delete({ where: { id } });
    return NextResponse.json({ data: { id }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/groups]',
      e,
      'CONFLICT',
      409,
      '削除できません（参照中の可能性があります）',
    );
  }
}
