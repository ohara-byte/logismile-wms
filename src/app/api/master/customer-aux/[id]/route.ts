/**
 * PUT    /api/master/customer-aux/[id]   更新
 * DELETE /api/master/customer-aux/[id]   削除
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const nullableStr = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? null : v));

const Body = z.object({
  customerName: z.string().min(1).max(100),
  customerKana: nullableStr(100),
  attrType: z
    .enum(['corp', 'personal', 'leave_at_door', 'redelivery_alert', 'attention', 'note'])
    .default('note'),
  note: nullableStr(1000),
  active: z.boolean().default(true),
});

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: '不正な ID' },
      { status: 422 },
    );
  }

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    const detailed = parsed.error.issues
      .map((i) => `[${(i.path ?? []).join('.') || '(body)'}] ${i.message}`)
      .join(' / ');
    return NextResponse.json(
      { error: 'VALIDATION', message: detailed || 'バリデーションエラー' },
      { status: 422 },
    );
  }

  try {
    const updated = await prisma.customerAuxAttr.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'レコードが見つかりません' },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: '不正な ID' },
      { status: 422 },
    );
  }
  try {
    await prisma.customerAuxAttr.delete({ where: { id } });
    return NextResponse.json({ data: { id }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/customer-aux]',
      e,
      'CONFLICT',
      409,
      '削除に失敗しました',
    );
  }
}
