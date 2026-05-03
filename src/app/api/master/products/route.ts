/**
 * GET  /api/master/products   一覧
 * POST /api/master/products   作成
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  code: z.string().min(1).max(20),
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

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const items = await prisma.product.findMany({
    orderBy: [{ active: 'desc' }, { code: 'asc' }],
    take: 1000,
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
    const created = await prisma.product.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `登録に失敗: ${e}` },
      { status: 409 },
    );
  }
}
