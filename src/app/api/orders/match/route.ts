/**
 * GET /api/orders/match?date=YYYY-MM-DD
 * 未検品照合タブ用 一覧 + 統計（A-12）
 *
 * モック準拠（管理用PCモック_v0.22.html L4614-4662）。
 *
 * 応答:
 *   {
 *     date,
 *     stats: { total, done, pending, matched, carryCandidate },
 *     items: MatchRow[],   // 全件（packed 含む。テーブル全件表示）
 *   }
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${dateStr}` },
      { status: 422 },
    );
  }
  date.setHours(0, 0, 0, 0);
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const orders = await prisma.shippingOrder.findMany({
    where: {
      shipDate: { gte: date, lt: tomorrow },
      deletedAt: null,
    },
    include: {
      carrier: { select: { code: true, name: true, short: true, cool: true } },
      items: { select: { id: true, qty: true, scannedQty: true, forceOk: true } },
      inspSession: {
        select: {
          staff: { select: { name: true } },
          device: { select: { location: true } },
        },
      },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    take: 1000,
  });

  const items = orders.map((o) => {
    const inspected = o.status === 'packed' || o.status === 'shipped';
    return {
      pkNo: o.pkNo,
      invoiceNo: o.invoiceNo,
      destName: o.destName,
      destAddr: o.destAddr,
      carrier: o.carrier
        ? {
            code: o.carrier.code,
            name: o.carrier.name,
            short: o.carrier.short,
            cool: o.carrier.cool,
          }
        : null,
      tableLabel: o.inspSession?.device?.location ?? null,
      staffName: o.inspSession?.staff?.name ?? null,
      itemCount: o.items.length,
      status: o.status,
      inspected,
      matchStatus: o.matchStatus, // 'none' | 'barcode' | 'visual'
      matchedAt: o.matchedAt?.toISOString() ?? null,
      matchedBy: o.matchedBy,
    };
  });

  const total = items.length;
  const done = items.filter((i) => i.inspected).length;
  const pending = total - done;
  const matched = items.filter((i) => i.matchStatus !== 'none').length;
  const carryCandidate = items.filter(
    (i) => !i.inspected && i.matchStatus !== 'none',
  ).length;

  return NextResponse.json({
    data: {
      date: date.toISOString().slice(0, 10),
      stats: { total, done, pending, matched, carryCandidate },
      items,
    },
    message: 'OK',
  });
}
