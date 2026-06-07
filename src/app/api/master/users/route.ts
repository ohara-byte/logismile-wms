/**
 * GET  /api/master/users   一覧（admin のみ）
 * POST /api/master/users   新規作成（admin のみ）
 *
 * Sprint Y-12: 管理 PC ユーザー（NextAuth credentials）の管理画面用 CRUD
 *  - email / role / staffCode / active を編集可能
 *  - 新規作成時はパスワード必須（bcrypt ハッシュして保存）
 *  - パスワードはレスポンスに含めない
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  email: z.string().email('正しいメールアドレスを入力してください').max(100),
  password: z.string().min(8, 'パスワードは 8 文字以上で設定してください').max(200),
  role: z.enum(['admin', 'manager', 'lead', 'staff', 'parttime']),
  staffCode: z.string().max(10).nullable().optional(),
  active: z.boolean().default(true),
});

export async function GET() {
  // ユーザー管理は admin のみ
  const guard = await requirePermission('user_admin');
  if (!guard.ok) return guard.response;

  const items = await prisma.user.findMany({
    orderBy: [{ active: 'desc' }, { email: 'asc' }],
    select: {
      id: true,
      email: true,
      role: true,
      staffCode: true,
      active: true,
      lastLogin: true,
      createdAt: true,
      staff: { select: { name: true, kana: true } },
    },
  });

  return NextResponse.json({
    data: {
      items: items.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        staffCode: u.staffCode,
        staffName: u.staff?.name ?? null,
        staffKana: u.staff?.kana ?? null,
        active: u.active,
        lastLogin: u.lastLogin?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
    },
    message: 'OK',
  });
}

export async function POST(req: Request) {
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

  // staffCode 指定があれば実在チェック
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
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const created = await prisma.user.create({
      data: {
        email: parsed.data.email,
        passwordHash,
        role: parsed.data.role,
        staffCode: parsed.data.staffCode ?? null,
        active: parsed.data.active,
      },
      select: {
        id: true,
        email: true,
        role: true,
        staffCode: true,
        active: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/users]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（メールアドレス重複の可能性）',
    );
  }
}
