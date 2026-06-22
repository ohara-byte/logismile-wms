/**
 * PUT    /api/master/app-settings/[key]   更新
 * DELETE /api/master/app-settings/[key]   削除
 * 2026-06-22: 梱包時間の全体設定など。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  // key は URL 側で確定。body の key は無視可だが受けても害なし。
  key: z.string().optional(),
  value: z.string().max(200),
  valueType: z.string().max(10).optional(),
  label: z.string().max(100).nullable().optional(),
  note: z.string().nullable().optional(),
});

export async function PUT(req: Request, { params }: { params: { key: string } }) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const key = decodeURIComponent(params.key);
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }
  const { value, valueType, label, note } = parsed.data;
  try {
    const updated = await prisma.appSetting.update({
      where: { key },
      data: {
        value,
        ...(valueType !== undefined ? { valueType } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(note !== undefined ? { note } : {}),
        updatedBy: guard.auth.staffCode ?? null,
      },
    });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND', message: '対象が見つかりません' }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { key: string } }) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const key = decodeURIComponent(params.key);
  try {
    await prisma.appSetting.delete({ where: { key } });
    return NextResponse.json({ data: { key }, message: 'OK' });
  } catch (e) {
    return maskError('[DELETE /api/master/app-settings]', e, 'NOT_FOUND', 404, '削除できません（対象が見つかりません）');
  }
}
