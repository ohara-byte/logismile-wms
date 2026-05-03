/**
 * GET  /api/master/devices   一覧
 * POST /api/master/devices   作成
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(50),
  type: z.string().min(1).max(20),
  model: z.string().max(50).nullable().optional(),
  location: z.string().max(50).nullable().optional(),
  active: z.boolean().default(true),
});

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const items = await prisma.device.findMany({
    orderBy: [{ active: 'desc' }, { type: 'asc' }, { code: 'asc' }],
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
    const created = await prisma.device.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/devices]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（コード重複の可能性）',
    );
  }
}
