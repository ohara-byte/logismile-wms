/**
 * GET  /api/master/std-times   一覧
 * POST /api/master/std-times   作成
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  code: z.string().min(1).max(20),
  groupId: z.string().min(1).max(10),
  tableId: z.string().min(1).max(5),
  stdMin: z.number().min(0).max(999.99).default(2),
  source: z.enum(['manual', 'auto', 'imported']).default('manual'),
  // 注: StdTime モデルに note 列は無い。誤って渡すと Prisma が例外を投げ、
  //   新規作成が「登録失敗」になるため Body から除外（旧バグ修正）。
});

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const items = await prisma.stdTime.findMany({
    orderBy: [{ groupId: 'asc' }, { tableId: 'asc' }],
  });
  return NextResponse.json({
    data: {
      items: items.map((s) => ({
        ...s,
        stdMin: Number(s.stdMin),
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
    const created = await prisma.stdTime.create({
      data: { ...parsed.data, updatedAt: new Date() },
    });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/std-times]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（コード重複の可能性）',
    );
  }
}
