/**
 * GET /api/link/aux-carr-usage
 * 配送便マッピング pane（Sprint S-3）用の利用状況集計。
 * - 運送会社コードごとの「当月件数」「本日件数」を返す。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const [todayGroups, monthGroups] = await Promise.all([
    prisma.shippingOrder.groupBy({
      by: ['carrierCode'],
      where: {
        shipDate: { gte: today, lt: tomorrow },
        deletedAt: null,
      },
      _count: { _all: true },
    }),
    prisma.shippingOrder.groupBy({
      by: ['carrierCode'],
      where: {
        shipDate: { gte: monthStart, lt: monthEnd },
        deletedAt: null,
      },
      _count: { _all: true },
    }),
  ]);

  const map = new Map<string, { code: string; todayCount: number; monthlyCount: number }>();
  for (const g of monthGroups) {
    map.set(g.carrierCode, {
      code: g.carrierCode,
      todayCount: 0,
      monthlyCount: g._count._all,
    });
  }
  for (const g of todayGroups) {
    const cur = map.get(g.carrierCode);
    if (cur) cur.todayCount = g._count._all;
    else
      map.set(g.carrierCode, {
        code: g.carrierCode,
        todayCount: g._count._all,
        monthlyCount: 0,
      });
  }

  return NextResponse.json({
    data: { items: Array.from(map.values()) },
    message: 'OK',
  });
}
