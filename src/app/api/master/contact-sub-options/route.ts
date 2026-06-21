/**
 * GET  /api/master/contact-sub-options   一覧
 * POST /api/master/contact-sub-options   作成
 *
 * 2026-06-21（②）: 本部連絡 サブ選択肢マスタ。
 *   タブレット／ハンディの本部連絡モーダルで、分類（のし／商品／伝票／WEB）ごとに
 *   表示するサブ選択肢ボタンを管理する。本部へは現仕様通りテキストで送信。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const CATEGORIES = ['noshi', 'product', 'input', 'web'] as const;

const Body = z.object({
  category: z.enum(CATEGORIES),
  label: z.string().min(1).max(100),
  sortOrder: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export async function GET() {
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;
  const items = await prisma.contactSubOption.findMany({
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
  });
  return NextResponse.json({ data: { items }, message: 'OK' });
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
    const created = await prisma.contactSubOption.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/contact-sub-options]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（同じ分類に同じ文言が既にある可能性）',
    );
  }
}
