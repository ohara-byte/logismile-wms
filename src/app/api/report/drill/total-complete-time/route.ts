/**
 * GET /api/report/drill/total-complete-time?from=&to=
 * 総出荷完了時間 KPI ドリルダウン（Sprint A-4）
 *
 * 期間内の日別「最終完了時刻」を返し、何時に作業が終わったかを可視化する。
 * 各日の最終完了セッションの完了時刻 + 件数。
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

  const sessions = await prisma.inspSession.findMany({
    where: { completedAt: { gte: from, lte: to, not: null } },
    select: { completedAt: true },
  });

  // 日別に「最終完了時刻」「件数」を集計
  const byDay = new Map<string, { last: Date; count: number }>();
  for (const s of sessions) {
    const d = s.completedAt!;
    const key = d.toISOString().slice(0, 10);
    const cur = byDay.get(key);
    if (!cur) {
      byDay.set(key, { last: d, count: 1 });
    } else {
      if (d > cur.last) cur.last = d;
      cur.count++;
    }
  }

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const items = Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, v]) => ({
      date: day,
      weekday: WEEKDAYS[new Date(day).getDay()],
      lastCompleted: `${String(v.last.getHours()).padStart(2, '0')}:${String(v.last.getMinutes()).padStart(2, '0')}`,
      count: v.count,
    }));

  return NextResponse.json({ data: { items }, message: 'OK' });
}
