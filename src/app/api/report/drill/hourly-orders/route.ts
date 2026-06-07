/**
 * GET /api/report/drill/hourly-orders?from=&to=&weekday=&hour=
 * 時間帯ピーク セルクリック ドリルダウン（Sprint C-1）
 *
 * 指定 weekday × hour に完了した検品セッションを返す。
 *   weekday: 0=日 〜 6=土
 *   hour:    0-23
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parsePeriodFromUrl } from '@/lib/report-period';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const range = parsePeriodFromUrl(req);
  if ('error' in range) return range.error;
  const { from, to } = range;

  const { searchParams } = new URL(req.url);
  const weekday = parseInt(searchParams.get('weekday') ?? '-1', 10);
  const hour = parseInt(searchParams.get('hour') ?? '-1', 10);
  if (weekday < 0 || weekday > 6 || hour < 0 || hour > 23) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'weekday (0-6) と hour (0-23) は必須' },
      { status: 422 },
    );
  }

  // 期間内の全完了セッションを取得し、weekday/hour でフィルタ
  const sessions = await prisma.inspSession.findMany({
    where: { completedAt: { gte: from, lte: to, not: null } },
    select: {
      durationSec: true,
      completedAt: true,
      order: {
        select: {
          pkNo: true,
          destName: true,
          carrier: { select: { short: true, name: true } },
          _count: { select: { items: true } },
        },
      },
      staff: { select: { name: true } },
    },
    take: 100000, // 2026-06-04: 上限実質撤廃
  });

  const filtered = sessions.filter((s) => {
    const d = s.completedAt!;
    return d.getDay() === weekday && d.getHours() === hour;
  });

  const items = filtered
    .sort((a, b) => (b.completedAt!.getTime() - a.completedAt!.getTime()))
    .slice(0, 200)
    .map((s) => ({
      pkNo: s.order?.pkNo ?? '—',
      destName: s.order?.destName ?? '—',
      carrier: s.order?.carrier?.short ?? s.order?.carrier?.name ?? '—',
      itemCount: s.order?._count.items ?? 0,
      staffName: s.staff?.name ?? '—',
      completedAt: s.completedAt
        ? `${s.completedAt.getMonth() + 1}/${s.completedAt.getDate()} ${String(s.completedAt.getHours()).padStart(2, '0')}:${String(s.completedAt.getMinutes()).padStart(2, '0')}`
        : '—',
      durationMin: ((s.durationSec ?? 0) / 60).toFixed(1),
    }));

  return NextResponse.json({
    data: { items, totalInBucket: filtered.length },
    message: 'OK',
  });
}
