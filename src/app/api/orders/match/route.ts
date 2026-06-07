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
      // Sprint Z-5: 引当差分判定のため Allocation も含める
      allocations: {
        select: { productCode: true, qty: true, status: true },
      },
      inspSession: {
        select: {
          staff: { select: { name: true } },
          device: { select: { location: true } },
        },
      },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    // 2026-06-04 バグ修正: 旧 take:1000 が件数を 1000 で頭打ちにし、統計（総件数/未検品 等）が
    //   常に 1000 になっていた。出荷指示は 1 日 2,000〜5,000 件のため上限を撤廃。
    //   shipDate の単日 WHERE 条件で自然にその日の件数に限定される（全件スキャンにはならない）。
    //   将来的に件数が極端に増えた場合はサーバーサイドページング化を検討。
  });

  const items = orders.map((o) => {
    const inspected = o.status === 'packed' || o.status === 'shipped';
    // 必要数 / 引当数 / 不足を伝票単位で集計（released 除外）
    const required = o.items.reduce((s, it) => s + it.qty, 0);
    const allocated = o.allocations
      .filter((a) => a.status !== 'released')
      .reduce((s, a) => s + a.qty, 0);
    const allocDiff = Math.max(required - allocated, 0);
    // 'full' = 引当が必要数を満たしている
    // 'partial' = 部分引当
    // 'none' = 引当ゼロ
    const allocStatus: 'full' | 'partial' | 'none' =
      required === 0 || allocated >= required
        ? 'full'
        : allocated > 0
          ? 'partial'
          : 'none';
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
      // Sprint Z-5: 引当差分情報
      requiredQty: required,
      allocatedQty: allocated,
      allocDiff,
      allocStatus,
    };
  });

  const total = items.length;
  const done = items.filter((i) => i.inspected).length;
  const pending = total - done;
  const matched = items.filter((i) => i.matchStatus !== 'none').length;
  const carryCandidate = items.filter(
    (i) => !i.inspected && i.matchStatus !== 'none',
  ).length;
  // Sprint Z-5: 引当差分集計
  const allocFull = items.filter((i) => i.allocStatus === 'full').length;
  const allocPartial = items.filter((i) => i.allocStatus === 'partial').length;
  const allocNone = items.filter((i) => i.allocStatus === 'none').length;
  const allocDiffCount = items.filter((i) => i.allocStatus !== 'full').length;

  return NextResponse.json({
    data: {
      date: date.toISOString().slice(0, 10),
      stats: {
        total,
        done,
        pending,
        matched,
        carryCandidate,
        allocFull,
        allocPartial,
        allocNone,
        allocDiffCount,
      },
      items,
    },
    message: 'OK',
  });
}
