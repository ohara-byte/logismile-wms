/**
 * GET  /api/master/staff   一覧
 * POST /api/master/staff   作成
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  code: z.string().min(1).max(10),
  empCode: z.string().min(1).max(20),
  name: z.string().min(1).max(30),
  kana: z.string().max(40).nullable().optional(),
  role: z.enum(['admin', 'manager', 'staff']).default('staff'),
  employmentTypeCode: z.string().max(20).nullable().optional(),
  groupId: z.string().max(10).nullable().optional(),
  defaultShiftPattern: z.string().max(10).nullable().optional(),
  tel: z.string().max(20).nullable().optional(),
  joined: z.string().nullable().optional(), // ISO date or empty
  assignable: z.boolean().default(true),
  active: z.boolean().default(true),
  skillCoefficient: z.number().min(0).max(9.999).default(1.0),
  note: z.string().nullable().optional(),
});

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const items = await prisma.staff.findMany({
    orderBy: [{ active: 'desc' }, { code: 'asc' }],
  });
  // Decimal を number 化
  const out = items.map((s) => ({
    ...s,
    skillCoefficient: Number(s.skillCoefficient),
    joined: s.joined ? s.joined.toISOString().slice(0, 10) : null,
    skillUpdatedAt: s.skillUpdatedAt?.toISOString() ?? null,
  }));
  return NextResponse.json({ data: { items: out }, message: 'OK' });
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
    const data = {
      ...parsed.data,
      joined: parsed.data.joined ? new Date(parsed.data.joined) : null,
    };
    const created = await prisma.staff.create({ data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `登録に失敗: ${e}` },
      { status: 409 },
    );
  }
}
