/**
 * GET /api/report/table-mh?from=&to=
 * テーブル（device.location）別の累計件数 + MH（A-Rep2）
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
    where: {
      completedAt: { gte: from, lte: to, not: null },
      durationSec: { not: null },
    },
    select: {
      durationSec: true,
      completedAt: true,
      device: { select: { code: true, location: true, type: true } },
    },
  });

  const map = new Map<string, { tableLabel: string; deviceCode: string; count: number; sec: number }>();
  for (const s of sessions) {
    const key =
      s.device?.location || (s.device?.code ? `device:${s.device.code}` : 'UNASSIGNED');
    const existing = map.get(key) ?? {
      tableLabel: key,
      deviceCode: s.device?.code ?? '—',
      count: 0,
      sec: 0,
    };
    existing.count += 1;
    existing.sec += s.durationSec ?? 0;
    map.set(key, existing);
  }

  const items = Array.from(map.values())
    .map((r) => ({
      tableLabel: r.tableLabel,
      deviceCode: r.deviceCode,
      count: r.count,
      mhHours: Math.round((r.sec / 3600) * 100) / 100,
      avgSec: r.count > 0 ? Math.round(r.sec / r.count) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ data: { items }, message: 'OK' });
}
