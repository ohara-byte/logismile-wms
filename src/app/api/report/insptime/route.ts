/**
 * GET /api/report/insptime?from=&to=
 * 検品時間分析（A-Rep2）
 *
 * - 全完了セッションの所要時間（秒）の分布バケット
 * - 平均 / 中央値 / p90 / p99 / max
 * - 商品点数別の平均（1点 / 2-5点 / 6-10点 / 11+点）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get('from');
  const toStr = searchParams.get('to');
  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'from / to は必須' },
      { status: 422 },
    );
  }
  const from = new Date(fromStr);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toStr);
  to.setHours(23, 59, 59, 999);

  const sessions = await prisma.inspSession.findMany({
    where: {
      completedAt: { gte: from, lte: to, not: null },
      durationSec: { not: null, gt: 0 },
    },
    select: {
      durationSec: true,
      order: { select: { _count: { select: { items: true } } } },
    },
  });

  if (sessions.length === 0) {
    return NextResponse.json({
      data: {
        count: 0,
        avg: 0,
        p50: 0,
        p90: 0,
        p99: 0,
        max: 0,
        buckets: [],
        byItemCount: [],
      },
      message: 'OK',
    });
  }

  const durations = sessions.map((s) => s.durationSec ?? 0).sort((a, b) => a - b);
  const total = durations.reduce((s, d) => s + d, 0);
  const avg = Math.round(total / durations.length);
  const p = (q: number) => durations[Math.min(Math.floor(durations.length * q), durations.length - 1)];

  // 30 秒バケット
  const BUCKET = 30;
  const bucketMap = new Map<number, number>();
  for (const d of durations) {
    const key = Math.floor(d / BUCKET) * BUCKET;
    bucketMap.set(key, (bucketMap.get(key) ?? 0) + 1);
  }
  const buckets = Array.from(bucketMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([sec, count]) => ({
      label: `${sec}-${sec + BUCKET}s`,
      sec,
      count,
    }));

  // 商品点数別
  const groups = [
    { label: '1点', min: 1, max: 1 },
    { label: '2-5点', min: 2, max: 5 },
    { label: '6-10点', min: 6, max: 10 },
    { label: '11+点', min: 11, max: 9999 },
  ];
  const byItemCount = groups.map((g) => {
    const matching = sessions.filter((s) => {
      const c = s.order._count.items;
      return c >= g.min && c <= g.max;
    });
    const sum = matching.reduce((acc, s) => acc + (s.durationSec ?? 0), 0);
    return {
      label: g.label,
      count: matching.length,
      avgSec: matching.length > 0 ? Math.round(sum / matching.length) : 0,
    };
  });

  return NextResponse.json({
    data: {
      count: durations.length,
      avg,
      p50: p(0.5),
      p90: p(0.9),
      p99: p(0.99),
      max: durations[durations.length - 1],
      buckets,
      byItemCount,
    },
    message: 'OK',
  });
}
