/**
 * PUT    /api/master/users/[id]   更新（admin のみ）
 * DELETE /api/master/users/[id]   削除（admin のみ。FK で失敗しやすいので active=false 推奨）
 *
 * Sprint Y-12: パスワードは空欄なら変更しない仕様（変更時のみハッシュ化）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  email: z.string().email().max(100),
  // 空欄なら変更しない（既存ハッシュ維持）
  password: z.string().max(200).optional().or(z.literal('')),
  role: z.enum(['admin', 'manager', 'lead', 'staff', 'parttime']),
  staffCode: z.string().max(10).nullable().optional(),
  active: z.boolean().default(true),
});

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requirePermission('user_admin');
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

  // 自分自身を無効化したり admin 以外に降格したりするのを防ぐ
  if (guard.auth.email === parsed.data.email) {
    if (!parsed.data.active) {
      return NextResponse.json(
        { error: 'CONFLICT', message: '自分自身を無効化することはできません' },
        { status: 409 },
      );
    }
    if (parsed.data.role !== 'admin' && guard.auth.role === 'admin') {
      return NextResponse.json(
        { error: 'CONFLICT', message: '自分自身の admin ロールを降格することはできません' },
        { status: 409 },
      );
    }
  }

  if (parsed.data.staffCode) {
    const exists = await prisma.staff.findUnique({
      where: { code: parsed.data.staffCode },
      select: { code: true },
    });
    if (!exists) {
      return NextResponse.json(
        { error: 'VALIDATION', message: '指定された担当者コードが存在しません' },
        { status: 422 },
      );
    }
  }

  try {
    const data: {
      email: string;
      role: string;
      staffCode: string | null;
      active: boolean;
      passwordHash?: string;
    } = {
      email: parsed.data.email,
      role: parsed.data.role,
      staffCode: parsed.data.staffCode ?? null,
      active: parsed.data.active,
    };
    if (parsed.data.password && parsed.data.password.length >= 8) {
      data.passwordHash = await bcrypt.hash(parsed.data.password, 10);
    }
    const updated = await prisma.user.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        staffCode: true,
        active: true,
      },
    });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'ユーザーが見つかりません（メール重複の可能性も）' },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requirePermission('user_admin');
  if (!guard.ok) return guard.response;

  // 自分自身は削除不可
  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { email: true },
  });
  if (target?.email === guard.auth.email) {
    return NextResponse.json(
      { error: 'CONFLICT', message: '自分自身を削除することはできません' },
      { status: 409 },
    );
  }

  try {
    await prisma.user.delete({ where: { id: params.id } });
    return NextResponse.json({ data: { id: params.id }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/users]',
      e,
      'CONFLICT',
      409,
      '削除できません（セッション履歴で参照中の可能性）。停止する場合は active=false を推奨します',
    );
  }
}
