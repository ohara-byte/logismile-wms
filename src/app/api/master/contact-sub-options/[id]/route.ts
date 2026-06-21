/**
 * PUT    /api/master/contact-sub-options/[id]   更新
 * DELETE /api/master/contact-sub-options/[id]   削除
 *
 * 2026-06-21（②）: 本部連絡 サブ選択肢マスタ。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const CATEGORIES = ['noshi', 'product', 'input', 'web'] as const;

const Body = z.object({
  category: z.enum(CATEGORIES),
  label: z.string().min(1).max(100),
  sortOrder: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'VALIDATION', message: 'ID が不正です' }, { status: 422 });
  }
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }
  try {
    const updated = await prisma.contactSubOption.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch (e) {
    return maskError(
      '[PUT /api/master/contact-sub-options]',
      e,
      'CONFLICT',
      409,
      '更新に失敗しました（同じ分類に同じ文言が既にある可能性）',
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'VALIDATION', message: 'ID が不正です' }, { status: 422 });
  }
  try {
    await prisma.contactSubOption.delete({ where: { id } });
    return NextResponse.json({ data: { id }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/contact-sub-options]',
      e,
      'NOT_FOUND',
      404,
      '削除できません（対象が見つかりません）',
    );
  }
}
