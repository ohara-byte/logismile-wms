/**
 * GET  /api/master/shift-patterns   一覧
 * POST /api/master/shift-patterns   作成
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  code: z.string().min(1).max(10),
  name: z.string().min(1).max(50),
  startTime: z.string().max(5).nullable().optional(),
  endTime: z.string().max(5).nullable().optional(),
  breakMin: z.number().int().min(0).default(0),
  isOff: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const items = await prisma.shiftPattern.findMany({
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
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
    const created = await prisma.shiftPattern.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `登録に失敗: ${e}` },
      { status: 409 },
    );
  }
}
