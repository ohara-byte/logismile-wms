/**
 * GET  /api/master/boxes   一覧
 * POST /api/master/boxes   作成
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  code: z.string().min(1).max(30),
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

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const items = await prisma.box.findMany({
    orderBy: [{ type: 'asc' }, { sizeRank: 'asc' }, { code: 'asc' }],
  });
  return NextResponse.json({ data: { items }, message: 'OK' });
}

export async function POST(req: Request) {
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
  try {
    const created = await prisma.box.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `登録に失敗: ${e}` },
      { status: 409 },
    );
  }
}
