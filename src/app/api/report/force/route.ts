/**
 * GET /api/report/force?from=&to=
 * 強制OK 分析（A-Rep3）
 *
 * 期間内の forceOk アイテムを 理由コード × 担当者 で集計。
 * R01 を含む全件を対象（除外しない・分析用途のため）。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseReasonCode } from '@/lib/force-ok';

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

  // 強制OK イベントは insp_logs (type='force_ok') が一次ソース
  const logs = await prisma.inspLog.findMany({
    where: {
      type: 'force_ok',
      createdAt: { gte: from, lte: to },
    },
    select: {
      itemCode: true,
      note: true,
      createdAt: true,
      session: {
        select: {
          staffCode: true,
          staff: { select: { name: true } },
        },
      },
    },
    take: 5000,
  });

  // 理由コード別集計
  const byReason = new Map<string, { count: number; pendingApproval: number }>();
  // 担当者別集計
  const byStaff = new Map<string, { staffName: string; count: number }>();
  for (const log of logs) {
    const code = parseReasonCode(log.note) ?? '不明';
    const r = byReason.get(code) ?? { count: 0, pendingApproval: 0 };
    r.count += 1;
    byReason.set(code, r);

    const sc = log.session.staffCode;
    const ent = byStaff.get(sc) ?? { staffName: log.session.staff?.name ?? sc, count: 0 };
    ent.count += 1;
    byStaff.set(sc, ent);
  }

  // 未承認数を併せて取得
  const pendingByCode = await prisma.shippingOrderItem.groupBy({
    by: ['forceReasonCode'],
    where: {
      forceOk: true,
      forceApprovalStatus: null,
      order: {
        deletedAt: null,
        shipDate: { gte: from, lte: to },
      },
    },
    _count: { _all: true },
  });
  for (const p of pendingByCode) {
    const code = p.forceReasonCode ?? '不明';
    const r = byReason.get(code) ?? { count: 0, pendingApproval: 0 };
    r.pendingApproval = p._count._all;
    byReason.set(code, r);
  }

  return NextResponse.json({
    data: {
      total: logs.length,
      byReason: Array.from(byReason.entries())
        .map(([code, v]) => ({ code, count: v.count, pendingApproval: v.pendingApproval }))
        .sort((a, b) => b.count - a.count),
      byStaff: Array.from(byStaff.entries())
        .map(([code, v]) => ({ staffCode: code, staffName: v.staffName, count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30),
    },
    message: 'OK',
  });
}
