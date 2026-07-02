/**
 * GET /api/carriers/today
 * 運送会社別 当日進捗（A-07 運送タブ用）
 *
 * 応答:
 *   {
 *     date: 'YYYY-MM-DD',
 *     totalShipments: number,
 *     items: CarrierStat[],
 *   }
 *
 * CarrierStat:
 *   carrier: { code, name, short, cool, pickup, cutoff, priority }
 *   total: 当日件数（deletedAt 除外）
 *   completed: packed 件数
 *   remaining: total - completed
 *   progressRate: completed / total （0..1）
 *   pickup: 'HH:MM' | null
 *   minutesUntilPickup: 分単位の残時間 | null
 *   alertLevel: 'normal' | 'warn' | 'alert'
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC, addDaysUTC, todayJstAsUTC } from '@/lib/date-utils';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get('date');
  // 日付根治(2026-07-02): @db.Date と一致する UTC 真夜中で当日範囲を作る（既定は JST 暦日）。
  const date = dateParam ? parseDateAsUTC(dateParam) : todayJstAsUTC();
  if (!date) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${dateParam}` },
      { status: 422 },
    );
  }
  const tomorrow = addDaysUTC(date, 1);

  // active な運送会社全件 + 当日伝票の集計
  const carriers = await prisma.carrier.findMany({
    where: { active: true },
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
  });

  // 当日伝票を運送会社 + status 単位で集計
  const grouped = await prisma.shippingOrder.groupBy({
    by: ['carrierCode', 'status'],
    where: {
      shipDate: { gte: date, lt: tomorrow },
      deletedAt: null,
    },
    _count: { _all: true },
  });

  // 集計を Map にして高速参照
  const counts = new Map<string, { total: number; completed: number }>();
  for (const g of grouped) {
    const cur = counts.get(g.carrierCode) ?? { total: 0, completed: 0 };
    cur.total += g._count._all;
    if (g.status === 'packed') cur.completed += g._count._all;
    counts.set(g.carrierCode, cur);
  }

  const now = new Date();
  const items = carriers.map((c) => {
    const cnt = counts.get(c.code) ?? { total: 0, completed: 0 };
    const remaining = Math.max(cnt.total - cnt.completed, 0);
    const progressRate = cnt.total > 0 ? cnt.completed / cnt.total : 0;
    const minutesUntilPickup = parsePickupMinutes(c.pickup, now);
    const alertLevel = computeAlertLevel(remaining, minutesUntilPickup);
    return {
      carrier: {
        code: c.code,
        name: c.name,
        short: c.short,
        cool: c.cool,
        pickup: c.pickup,
        cutoff: c.cutoff,
        priority: c.priority,
      },
      total: cnt.total,
      completed: cnt.completed,
      remaining,
      progressRate,
      minutesUntilPickup,
      alertLevel,
    };
  });

  const totalShipments = items.reduce((sum, i) => sum + i.total, 0);

  return NextResponse.json({
    data: {
      date: date.toISOString().slice(0, 10),
      totalShipments,
      items,
    },
    message: 'OK',
  });
}

function parsePickupMinutes(pickup: string | null, now: Date): number | null {
  if (!pickup) return null;
  const m = pickup.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 60_000);
}

function computeAlertLevel(
  remaining: number,
  minutesUntilPickup: number | null,
): 'normal' | 'warn' | 'alert' {
  if (minutesUntilPickup === null) return 'normal';
  if (minutesUntilPickup < 0) return 'normal'; // 集荷時刻を過ぎた
  if (minutesUntilPickup < 60 && remaining > 100) return 'alert';
  if (minutesUntilPickup < 90 && remaining > 50) return 'warn';
  return 'normal';
}
