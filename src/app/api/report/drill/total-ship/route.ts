/**
 * GET /api/report/drill/total-ship?from=&to=&limit=
 * 総出荷数 KPI ドリルダウン（Sprint A-2）
 *
 * 期間内の出荷伝票から代表 N 件を返す。
 * モック準拠（管理用PCモック_v0.22.html L9314-9339 totalShip ドリルダウン）。
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

  const orders = await prisma.shippingOrder.findMany({
    where: {
      shipDate: { gte: from, lte: to },
      deletedAt: null,
    },
    include: {
      carrier: { select: { short: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: [{ shipDate: 'desc' }, { pkNo: 'desc' }],
    take: limit,
  });

  // 期間内総件数（KPI と整合確認用）
  const total = await prisma.shippingOrder.count({
    where: {
      shipDate: { gte: from, lte: to },
      deletedAt: null,
    },
  });

  const STATUS_LABEL: Record<string, string> = {
    pending: '未着手',
    inspecting: '検品中',
    packed: '完了',
    shipped: '出荷済',
    held: '保留',
  };

  const items = orders.map((o) => ({
    pkNo: o.pkNo,
    destName: o.destName ?? '—',
    carrier: o.carrier?.short ?? o.carrier?.name ?? '—',
    itemCount: o._count.items,
    shipDate: o.shipDate.toISOString().slice(0, 10),
    statusLabel: STATUS_LABEL[o.status] ?? o.status,
  }));

  return NextResponse.json({ data: { items, total, limit }, message: 'OK' });
}
