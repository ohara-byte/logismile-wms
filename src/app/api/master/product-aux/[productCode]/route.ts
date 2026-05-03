import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  dispName: z.string().max(100).nullable().optional(),
  tempZone: z.enum(['ambient', 'cool', 'frozen']).default('ambient'),
  specialPkg: z.string().max(30).nullable().optional(),
  stdSec: z.number().int().min(0).default(0),
  transferred: z.boolean().default(false),
  wMm: z.number().int().min(0).default(0),
  dMm: z.number().int().min(0).default(0),
  hMm: z.number().int().min(0).default(0),
  note: z.string().nullable().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: { productCode: string } },
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
  const productCode = decodeURIComponent(params.productCode);
  try {
    const updated = await prisma.productAuxAttr.update({
      where: { productCode },
      data: parsed.data,
    });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: '属性補助レコードがありません' },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { productCode: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const productCode = decodeURIComponent(params.productCode);
  try {
    await prisma.productAuxAttr.delete({ where: { productCode } });
    return NextResponse.json({ data: { productCode }, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `削除できません: ${e}` },
      { status: 409 },
    );
  }
}
