/**
 * GET  /api/notices  — 一覧取得
 * POST /api/notices  — 新規作成
 *
 * クエリ:
 *   kind=announce|inbox  種別フィルタ（既定なし＝全件）
 *   date=YYYY-MM-DD      対象日（announce 既定=今日。inbox では使わない）
 *   category=...         inbox 用分類フィルタ
 *   unread=true          inbox の未読のみ
 *   target=...           announce 用宛先タイプ
 *   target_id=...
 *
 * 用途:
 *  - ハンディ起動時の連絡事項モーダル（kind=announce, date=today）
 *  - 管理PC「📢 連絡」タブ（announce 履歴 / inbox 一覧）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get('kind') as 'announce' | 'inbox' | null;
  const dateStr = searchParams.get('date');
  const date = dateStr ? new Date(dateStr) : null;
  if (date && isNaN(date.getTime())) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${dateStr}` },
      { status: 422 },
    );
  }

  const targetType = searchParams.get('target');
  const targetId = searchParams.get('target_id');
  const category = searchParams.get('category');
  const unread = searchParams.get('unread') === 'true';

  // モバイルからのアクセスは announce + 今日 + 自分宛のみに限定
  const isMobile = guard.auth.source === 'mobile';
  const effectiveKind = isMobile ? 'announce' : kind;
  const effectiveDate = isMobile ? new Date() : date;
  if (effectiveDate) effectiveDate.setHours(0, 0, 0, 0);

  const items = await prisma.notice.findMany({
    where: {
      active: true,
      ...(effectiveKind ? { kind: effectiveKind } : {}),
      ...(effectiveDate ? { date: effectiveDate } : {}),
      ...(targetType
        ? { targetType, ...(targetId ? { targetId } : {}) }
        : {}),
      ...(category ? { category } : {}),
      ...(unread ? { readAt: null } : {}),
    },
    orderBy: [{ priority: 'desc' }, { id: 'desc' }],
    take: 200,
  });

  return NextResponse.json({ data: { items }, message: 'OK' });
}

const PostBody = z.object({
  kind: z.enum(['announce', 'inbox']).default('announce'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1),
  body: z.string().nullable().optional(),
  targetType: z.enum(['all', 'tablet', 'handy', 'group', 'staff', 'table']).default('all'),
  targetId: z.string().nullable().optional(),
  category: z.enum(['noshi', 'product', 'input', 'web', 'other']).nullable().optional(),
  ackRequired: z.boolean().default(false),
  senderCode: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(100).default(50),
});

export async function POST(req: Request) {
  // announce の作成は admin/manager 限定
  // inbox の作成は staff（モバイル）からも許可
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  // モバイルから announce を作ろうとした場合は拒否（管理機能はPC限定）
  if (guard.auth.source === 'mobile' && parsed.data.kind === 'announce') {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '発信は管理 PC からのみ実行可能です' },
      { status: 403 },
    );
  }

  const created = await prisma.notice.create({
    data: {
      kind: parsed.data.kind,
      date: new Date(parsed.data.date),
      title: parsed.data.title,
      body: parsed.data.body ?? null,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId ?? null,
      category: parsed.data.category ?? null,
      ackRequired: parsed.data.ackRequired,
      // 発信者は admin/manager の staff_code、着信は引数優先
      senderCode:
        parsed.data.senderCode ??
        (parsed.data.kind === 'inbox' ? guard.auth.staffCode ?? null : guard.auth.staffCode ?? null),
      priority: parsed.data.priority,
      active: true,
    },
  });

  return NextResponse.json({ data: created, message: 'OK' });
}
