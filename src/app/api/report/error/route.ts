/**
 * GET /api/report/error?from=&to=
 * 検品エラー率（A-Rep4）
 *
 * insp_logs (type='scan') のうち note フィールドの結果区分を集計:
 *   matched / over_scan / not_found / already_done
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

  // type='scan' の result 区分 (note に格納されている)
  const grouped = await prisma.inspLog.groupBy({
    by: ['note'],
    where: {
      type: 'scan',
      createdAt: { gte: from, lte: to },
    },
    _count: { _all: true },
  });

  const counts = {
    matched: 0,
    over_scan: 0,
    not_found: 0,
    already_done: 0,
    other: 0,
  };
  for (const g of grouped) {
    const k = (g.note ?? 'other') as keyof typeof counts;
    if (k in counts) counts[k] += g._count._all;
    else counts.other += g._count._all;
  }
  const total =
    counts.matched +
    counts.over_scan +
    counts.not_found +
    counts.already_done +
    counts.other;
  const errors = counts.over_scan + counts.not_found + counts.already_done + counts.other;

  // 担当者別の error 率（top10）
  const errorLogs = await prisma.inspLog.findMany({
    where: {
      type: 'scan',
      note: { in: ['over_scan', 'not_found', 'already_done'] },
      createdAt: { gte: from, lte: to },
    },
    select: {
      session: {
        select: {
          staffCode: true,
          staff: { select: { name: true } },
        },
      },
    },
    take: 50000,
  });
  const allLogs = await prisma.inspLog.findMany({
    where: {
      type: 'scan',
      createdAt: { gte: from, lte: to },
    },
    select: {
      session: { select: { staffCode: true } },
    },
    take: 100000,
  });
  const totalByStaff = new Map<string, number>();
  for (const l of allLogs) {
    const sc = l.session.staffCode;
    totalByStaff.set(sc, (totalByStaff.get(sc) ?? 0) + 1);
  }
  const errorByStaff = new Map<string, { name: string; error: number }>();
  for (const l of errorLogs) {
    const sc = l.session.staffCode;
    const cur = errorByStaff.get(sc) ?? {
      name: l.session.staff?.name ?? sc,
      error: 0,
    };
    cur.error += 1;
    errorByStaff.set(sc, cur);
  }
  const byStaff = Array.from(errorByStaff.entries())
    .map(([code, v]) => ({
      staffCode: code,
      staffName: v.name,
      errorCount: v.error,
      totalCount: totalByStaff.get(code) ?? 0,
      errorRate: totalByStaff.get(code)
        ? v.error / (totalByStaff.get(code) ?? 1)
        : 0,
    }))
    .filter((s) => s.totalCount >= 10) // 件数少ない人は除外
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10);

  return NextResponse.json({
    data: {
      total,
      counts,
      errorCount: errors,
      errorRate: total > 0 ? errors / total : 0,
      byStaff,
    },
    message: 'OK',
  });
}
