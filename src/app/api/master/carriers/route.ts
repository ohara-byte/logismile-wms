/**
 * GET  /api/master/carriers   一覧
 * POST /api/master/carriers   作成
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  code: z.string().min(1).max(20),
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

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const items = await prisma.carrier.findMany({
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
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
    const created = await prisma.carrier.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `登録に失敗（コード重複の可能性）: ${e}` },
      { status: 409 },
    );
  }
}
