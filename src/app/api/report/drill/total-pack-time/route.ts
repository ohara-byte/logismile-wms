/**
 * GET /api/report/drill/total-pack-time?from=&to=&limit=
 * 総梱包時間 KPI ドリルダウン（Sprint A-3）
 *
 * 期間内の検品セッションから所要時間が長い順 N 件を返す。
 * 「どの伝票に時間がかかっているか」を一覧で確認する用途。
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
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') ?? '30', 10) || 30, 1),
    200,
  );

  const sessions = await prisma.inspSession.findMany({
    where: {
      completedAt: { gte: from, lte: to, not: null },
      durationSec: { not: null, gt: 0 },
    },
    select: {
      durationSec: true,
      completedAt: true,
      order: {
        select: {
          pkNo: true,
          destName: true,
          _count: { select: { items: true } },
        },
      },
      staff: { select: { name: true } },
    },
    orderBy: { durationSec: 'desc' },
    take: limit,
  });

  const items = sessions.map((s) => ({
    pkNo: s.order?.pkNo ?? '—',
    destName: s.order?.destName ?? '—',
    staffName: s.staff?.name ?? '—',
    itemCount: s.order?._count.items ?? 0,
    durationSec: s.durationSec ?? 0,
    durationMin: ((s.durationSec ?? 0) / 60).toFixed(1),
    completedAt: s.completedAt
      ? `${s.completedAt.getMonth() + 1}/${s.completedAt.getDate()} ${String(s.completedAt.getHours()).padStart(2, '0')}:${String(s.completedAt.getMinutes()).padStart(2, '0')}`
      : '—',
  }));

  return NextResponse.json({ data: { items, limit }, message: 'OK' });
}
