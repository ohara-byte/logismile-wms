/**
 * GET  /api/master/departments   一覧
 * POST /api/master/departments   新規登録
 *
 * Sprint Y-7: 部署マスタ
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(50),
  sortOrder: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
  note: z.string().nullable().optional(),
});

export async function GET() {
  // 部署一覧は staff マスタ画面の選択肢として使うため、
  // staff ロールにも参照のみ許可（編集は admin/manager）
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const items = await prisma.department.findMany({
    orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { code: 'asc' }],
  });
  return NextResponse.json({ data: { items }, message: 'OK' });
}

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: parsed.error.issues.map((i) => i.message).join(', '),
      },
      { status: 422 },
    );
  }

  try {
    const created = await prisma.department.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/departments]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（コード重複の可能性）',
    );
  }
}
