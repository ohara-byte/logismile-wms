/**
 * PUT    /api/master/carrier-aliases/[id]   更新
 * DELETE /api/master/carrier-aliases/[id]   削除
 *
 * 2026-06-02: 運送会社 便種名マッピングの編集／削除。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  aliasName: z.string().min(1).max(100),
  carrierCode: z.string().min(1).max(20),
  active: z.boolean().default(true),
  note: z.string().nullable().optional(),
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
      { error: 'VALIDATION', message: 'ID が不正です' },
      { status: 422 },
    );
  }
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }
  const carrier = await prisma.carrier.findUnique({
    where: { code: parsed.data.carrierCode },
    select: { code: true },
  });
  if (!carrier) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `運送会社コード「${parsed.data.carrierCode}」が存在しません` },
      { status: 422 },
    );
  }
  try {
    const updated = await prisma.carrierAlias.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: '対象が見つかりません' },
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
      { error: 'VALIDATION', message: 'ID が不正です' },
      { status: 422 },
    );
  }
  try {
    await prisma.carrierAlias.delete({ where: { id } });
    return NextResponse.json({ data: { id }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/carrier-aliases]',
      e,
      'NOT_FOUND',
      404,
      '削除できません（対象が見つかりません）',
    );
  }
}
