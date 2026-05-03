/**
 * PUT    /api/master/boxes/[code]   更新
 * DELETE /api/master/boxes/[code]   削除
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  name: z.string().min(1).max(100),
  type: z.string().min(1).max(20),
  sizeRank: z.number().int().default(0),
  wMm: z.number().int().default(0),
  dMm: z.number().int().default(0),
  hMm: z.number().int().default(0),
  innerWMm: z.number().int().default(0),
  innerDMm: z.number().int().default(0),
  innerHMm: z.number().int().default(0),
  frozen: z.boolean().default(false),
  noshi: z.boolean().default(false),
  priority: z.number().int().default(50),
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
    const updated = await prisma.box.update({ where: { code }, data: parsed.data });
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
    await prisma.box.delete({ where: { code } });
    return NextResponse.json({ data: { code }, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `削除できません: ${e}` },
      { status: 409 },
    );
  }
}
