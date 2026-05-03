import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  jan: z.string().max(13).nullable().optional(),
  name: z.string().min(1).max(100),
  cat: z.string().min(1).max(20),
  pkg: z.string().max(20).default('箱'),
  price: z.number().int().min(0).default(0),
  leadDays: z.number().int().min(0).default(0),
  stdSec: z.number().int().min(0).default(0),
  frozen: z.boolean().default(false),
  special: z.boolean().default(false),
  noshi: z.boolean().default(false),
  active: z.boolean().default(true),
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
    const updated = await prisma.product.update({ where: { code }, data: parsed.data });
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
    await prisma.product.delete({ where: { code } });
    return NextResponse.json({ data: { code }, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `削除できません（参照中の可能性）。active=false 推奨: ${e}` },
      { status: 409 },
    );
  }
}
