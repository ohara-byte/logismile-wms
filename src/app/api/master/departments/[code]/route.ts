/**
 * PUT    /api/master/departments/[code]   更新
 * DELETE /api/master/departments/[code]   削除
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  name: z.string().min(1).max(50),
  sortOrder: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
  note: z.string().nullable().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: { code: string } },
) {
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

  const code = decodeURIComponent(params.code);
  try {
    const updated = await prisma.department.update({
      where: { code },
      data: parsed.data,
    });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: '部署が見つかりません' },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { code: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const code = decodeURIComponent(params.code);
  try {
    await prisma.department.delete({ where: { code } });
    return NextResponse.json({ data: { code }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/departments]',
      e,
      'CONFLICT',
      409,
      '削除できません（履歴で参照中の可能性）。停止する場合は active=false を推奨します',
    );
  }
}
