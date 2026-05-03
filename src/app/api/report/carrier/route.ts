/**
 * GET /api/report/carrier?from=&to=
 * 配送便種別 集計（A-Rep3）
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

  const orders = await prisma.shippingOrder.findMany({
    where: {
      shipDate: { gte: from, lte: to },
      deletedAt: null,
    },
    select: {
      carrierCode: true,
      status: true,
      carrier: { select: { code: true, name: true, short: true, cool: true } },
      inspSession: { select: { durationSec: true } },
    },
  });

  const map = new Map<
    string,
    {
      code: string;
      name: string;
      short: string | null;
      cool: boolean;
      total: number;
      packed: number;
      sec: number;
      countSec: number;
    }
  >();

  for (const o of orders) {
    const c = o.carrier;
    if (!c) continue;
    const ent = map.get(c.code) ?? {
      code: c.code,
      name: c.name,
      short: c.short,
      cool: c.cool,
      total: 0,
      packed: 0,
      sec: 0,
      countSec: 0,
    };
    ent.total += 1;
    if (o.status === 'packed' || o.status === 'shipped') ent.packed += 1;
    if (o.inspSession?.durationSec) {
      ent.sec += o.inspSession.durationSec;
      ent.countSec += 1;
    }
    map.set(c.code, ent);
  }

  const items = Array.from(map.values())
    .map((r) => ({
      code: r.code,
      name: r.name,
      short: r.short,
      cool: r.cool,
      total: r.total,
      packed: r.packed,
      remaining: r.total - r.packed,
      mhHours: Math.round((r.sec / 3600) * 100) / 100,
      avgSec: r.countSec > 0 ? Math.round(r.sec / r.countSec) : 0,
      progressRate: r.total > 0 ? r.packed / r.total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({ data: { items }, message: 'OK' });
}
