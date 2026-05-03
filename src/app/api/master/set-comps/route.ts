/**
 * GET  /api/master/set-comps   一覧（親）
 * POST /api/master/set-comps   作成（親のみ。子は別 endpoint）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  id: z.string().min(1).max(30),
  parentCode: z.string().min(1).max(20),
  parentName: z.string().min(1).max(100),
  type: z.enum(['set', 'koudoku', 'noshi', 'other']).default('set'),
  fixedBoxCode: z.string().max(30).nullable().optional(),
  packingNote: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const items = await prisma.setComp.findMany({
    orderBy: [{ parentCode: 'asc' }],
    include: {
      _count: { select: { children: true } },
      fixedBox: { select: { code: true, name: true } },
    },
    take: 500,
  });
  return NextResponse.json({
    data: {
      items: items.map((s) => ({
        id: s.id,
        parentCode: s.parentCode,
        parentName: s.parentName,
        type: s.type,
        fixedBoxCode: s.fixedBoxCode,
        fixedBoxName: s.fixedBox?.name ?? null,
        packingNote: s.packingNote,
        note: s.note,
        childCount: s._count.children,
        updatedAt: s.updatedAt.toISOString().slice(0, 10),
      })),
    },
    message: 'OK',
  });
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
    const created = await prisma.setComp.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/set-comps]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（ID 重複の可能性）',
    );
  }
}
