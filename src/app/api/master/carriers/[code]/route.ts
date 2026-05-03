/**
 * PUT    /api/master/carriers/[code]   更新
 * DELETE /api/master/carriers/[code]   削除（FK で参照中なら 409）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  name: z.string().min(1).max(50),
  short: z.string().max(20).nullable().optional(),
  priority: z.number().int().default(99),
  cutoff: z.string().max(5).nullable().optional(),
  pickup: z.string().max(5).nullable().optional(),
  cool: z.boolean().default(false),
  wbType: z.string().max(30).nullable().optional(),
  contact: z.string().max(100).nullable().optional(),
  active: z.boolean().default(true),
  note: z.string().nullable().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: { code: string } },
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
  const code = decodeURIComponent(params.code);
  try {
    const updated = await prisma.carrier.update({ where: { code }, data: parsed.data });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'コードが見つかりません' },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { code: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const code = decodeURIComponent(params.code);
  try {
    await prisma.carrier.delete({ where: { code } });
    return NextResponse.json({ data: { code }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/carriers]',
      e,
      'CONFLICT',
      409,
      '削除できません（参照中の可能性があります）',
    );
  }
}
