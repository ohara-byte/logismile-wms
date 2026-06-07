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
import { parseDateAsUTC, todayJstAsUTC } from '@/lib/date-utils';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get('kind') as 'announce' | 'inbox' | null;
  const dateStr = searchParams.get('date');
  // 2026-06-06 修正: 日付は JST 暦を UTC 真夜中に統一（date-utils）。
  //   旧実装の `new Date()` + setHours は JST 環境で UTC 前日にずれ、@db.Date 保存値と
  //   一致せず「端末が連絡を受け取らない／管理PC履歴が 0 件」になっていた（シフトと同じ1日ずれバグ）。
  const date = dateStr ? parseDateAsUTC(dateStr) : null;
  if (dateStr && !date) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${dateStr}` },
      { status: 422 },
    );
  }

  const targetType = searchParams.get('target');
  const targetId = searchParams.get('target_id');
  const category = searchParams.get('category');
  const unread = searchParams.get('unread') === 'true';

  // モバイルからのアクセスは「今日（JST 暦）」のレコードのみ。
  const isMobile = guard.auth.source === 'mobile';
  const effectiveKind = kind; // モバイルでも kind が来ればそれを使う
  const effectiveDate = isMobile ? todayJstAsUTC() : date;

  // Sprint Y-16: モバイルからの参照は announce のみ（inbox は管理 PC が処理）
  //   さらに unread=true の時は「現在の社員が ack していない」announce に絞る。
  //   グローバルな readAt ではなく per-staff の NoticeAck で判定する。
  const mobileStaffCode = isMobile ? guard.auth.staffCode : null;
  const ackedIds = mobileStaffCode
    ? new Set(
        (
          await prisma.noticeAck.findMany({
            where: { staffCode: mobileStaffCode },
            select: { noticeId: true },
          })
        ).map((a) => a.noticeId),
      )
    : null;

  const items = await prisma.notice.findMany({
    where: {
      active: true,
      ...(effectiveKind
        ? { kind: effectiveKind }
        : isMobile
          ? { kind: 'announce' }
          : {}),
      ...(effectiveDate ? { date: effectiveDate } : {}),
      ...(targetType
        ? { targetType, ...(targetId ? { targetId } : {}) }
        : {}),
      ...(category ? { category } : {}),
      // unread フィルタ:
      //   PC: 旧来の Notice.readAt = null
      //   モバイル: per-staff の NoticeAck に未登録（下で post-filter）
      ...(unread && !isMobile ? { readAt: null } : {}),
    },
    orderBy: [{ priority: 'desc' }, { id: 'desc' }],
    take: 200,
  });

  // ── モバイルの宛先フィルタ配信（2026-06-06）──
  //   targetType ごとに「この端末/担当者が対象か」を判定して配信する。
  //   旧実装は target を無視して全 announce を返していたため、
  //   「タブレット指定」がハンディにも、「担当者指定」が全員に届いていた。
  let filtered = items;
  if (isMobile) {
    // 端末種別（tablet/handy）と所属グループを取得して照合
    const dev = guard.auth.deviceCode
      ? await prisma.device.findUnique({
          where: { code: guard.auth.deviceCode },
          select: { type: true },
        })
      : null;
    const deviceType = dev?.type ?? null;
    const st = mobileStaffCode
      ? await prisma.staff.findUnique({
          where: { code: mobileStaffCode },
          select: { groupId: true },
        })
      : null;
    const myGroupId = st?.groupId ?? null;

    const matchesTarget = (n: { targetType: string; targetId: string | null }) => {
      switch (n.targetType) {
        case 'all':
          return true;
        case 'tablet':
          return deviceType === 'tablet';
        case 'handy':
          return deviceType === 'handy';
        case 'group':
          return !!myGroupId && n.targetId === myGroupId;
        case 'staff':
          return n.targetId === mobileStaffCode;
        default:
          return true; // 'table' 等レガシーは配信（取りこぼし防止）
      }
    };

    filtered = filtered.filter(matchesTarget);
    if (unread && ackedIds) {
      filtered = filtered.filter((n) => !ackedIds.has(n.id));
    }
  }

  return NextResponse.json({ data: { items: filtered }, message: 'OK' });
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
      // JST 暦を UTC 真夜中に統一（GET 側 todayJstAsUTC/parseDateAsUTC と一致させる）
      date: parseDateAsUTC(parsed.data.date) ?? todayJstAsUTC(),
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
