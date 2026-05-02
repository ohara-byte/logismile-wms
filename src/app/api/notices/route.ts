/**
 * GET /api/notices?date=YYYY-MM-DD
 * 当日の連絡事項一覧
 *
 * クエリ:
 *  - date: 対象日（既定 = 今日）
 *  - target: 'all' | 'group' | 'table'（任意。指定なしで全件）
 *  - target_id: target が group/table のときに必須
 *
 * 用途:
 *  - ハンディ起動時のモーダル表示
 *  - 管理PCの連絡事項一覧
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${dateStr}` },
      { status: 422 },
    );
  }

  const targetType = searchParams.get('target');
  const targetId = searchParams.get('target_id');

  const items = await prisma.notice.findMany({
    where: {
      date,
      active: true,
      ...(targetType
        ? { targetType, ...(targetId ? { targetId } : {}) }
        : {}),
    },
    orderBy: [{ priority: 'desc' }, { id: 'asc' }],
  });

  return NextResponse.json({ data: { items }, message: 'OK' });
}

const PostBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1),
  body: z.string().nullable().optional(),
  targetType: z.enum(['all', 'group', 'table']).default('all'),
  targetId: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(100).default(50),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const created = await prisma.notice.create({
    data: {
      date: new Date(parsed.data.date),
      title: parsed.data.title,
      body: parsed.data.body ?? null,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId ?? null,
      priority: parsed.data.priority,
      active: true,
    },
  });

  return NextResponse.json({ data: created, message: 'OK' });
}
