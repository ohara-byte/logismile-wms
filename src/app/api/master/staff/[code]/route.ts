/**
 * PUT    /api/master/staff/[code]   更新
 * DELETE /api/master/staff/[code]   削除
 *
 * 削除は FK 参照（出荷指示・検品セッション等）で失敗しやすいので
 * 実運用では active=false の論理削除を推奨。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  empCode: z.string().min(1).max(20),
  name: z.string().min(1).max(30),
  kana: z.string().max(40).nullable().optional(),
  role: z.enum(['admin', 'manager', 'staff']).default('staff'),
  employmentTypeCode: z.string().max(20).nullable().optional(),
  groupId: z.string().max(10).nullable().optional(),
  defaultShiftPattern: z.string().max(10).nullable().optional(),
  tel: z.string().max(20).nullable().optional(),
  joined: z.string().nullable().optional(),
  assignable: z.boolean().default(true),
  active: z.boolean().default(true),
  skillCoefficient: z.number().min(0).max(9.999).default(1.0),
  note: z.string().nullable().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: { code: string } },
) {
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
  const code = decodeURIComponent(params.code);

  // 権限昇格防止（B-2 / C-2）: manager は admin ロールへ昇格できない
  if (parsed.data.role === 'admin' && guard.auth.role !== 'admin') {
    const existing = await prisma.staff.findUnique({
      where: { code },
      select: { role: true },
    });
    if (!existing || existing.role !== 'admin') {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'admin ロールへの変更は admin 権限のみ可能です',
        },
        { status: 403 },
      );
    }
  }

  try {
    const data = {
      ...parsed.data,
      joined: parsed.data.joined ? new Date(parsed.data.joined) : null,
    };
    const updated = await prisma.staff.update({ where: { code }, data });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'コードが見つかりません' },
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
    await prisma.staff.delete({ where: { code } });
    return NextResponse.json({ data: { code }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/staff]',
      e,
      'CONFLICT',
      409,
      '削除できません（出荷・検品履歴で参照中の可能性）。退職者は active=false での論理削除を推奨します',
    );
  }
}
