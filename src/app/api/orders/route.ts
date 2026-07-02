/**
 * GET /api/orders
 * 出荷指示一覧（管理PC用）
 *
 * クエリ:
 *  - shipDate: YYYY-MM-DD
 *  - status: pending|inspecting|packed|shipped|held
 *  - q: PkNo / 配送先 / 納品書№ 部分一致
 *  - carrier: 運送会社コード
 *  - includeDeleted: 'true' で論理削除も含める
 *  - excludeHeld: 'true' で status='held' を結果から除外する（既定は含める）
 *  - page / limit
 */

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC, addDaysUTC } from '@/lib/date-utils';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const shipDate = searchParams.get('shipDate');
  const status = searchParams.get('status');
  const q = searchParams.get('q')?.trim();
  const carrier = searchParams.get('carrier');
  const includeDeleted = searchParams.get('includeDeleted') === 'true';
  const excludeHeld = searchParams.get('excludeHeld') === 'true';
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);

  // 出荷日は UTC 真夜中で範囲化（@db.Date と一致）。日付根治(2026-07-02)で ship_date を正しい暦日に
  //   補正済みのため、他の全 shipDate クエリと同じ UTC 基準・翌日未満の半開区間で照会する。
  const shipFrom = shipDate ? parseDateAsUTC(shipDate) : null;
  const shipTo = shipFrom ? addDaysUTC(shipFrom, 1) : null;

  const where: Prisma.ShippingOrderWhereInput = {
    ...(shipFrom && shipTo ? { shipDate: { gte: shipFrom, lt: shipTo } } : {}),
    // status の明示指定が優先。excludeHeld は status 未指定時のみ作用させる
    ...(status
      ? { status }
      : excludeHeld
        ? { status: { not: 'held' } }
        : {}),
    ...(carrier ? { carrierCode: carrier } : {}),
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(q
      ? {
          OR: [
            { pkNo: { contains: q, mode: 'insensitive' } },
            { invoiceNo: { contains: q, mode: 'insensitive' } },
            { destName: { contains: q, mode: 'insensitive' } },
            { destAddr: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.shippingOrder.findMany({
      where,
      orderBy: [{ shipDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        carrier: { select: { code: true, name: true, short: true, cool: true } },
        items: { select: { productCode: true, qty: true, scannedQty: true, forceOk: true } },
        // Sprint Z-1: 引当行を含めて allocStatus を計算
        allocations: {
          select: { productCode: true, qty: true, status: true },
        },
      },
    }),
    prisma.shippingOrder.count({ where }),
  ]);

  return NextResponse.json({
    data: {
      items: items.map((o) => {
        // Sprint Z-1: 引当状態の計算
        //   needBySku: 商品ごとの必要数
        //   allocBySku: 商品ごとの引当数（released を除く）
        //   allocStatus: 'full' / 'partial' / 'none'
        const needBySku = new Map<string, number>();
        for (const it of o.items) {
          needBySku.set(
            it.productCode,
            (needBySku.get(it.productCode) ?? 0) + it.qty,
          );
        }
        const allocBySku = new Map<string, number>();
        for (const a of o.allocations) {
          if (a.status === 'released') continue;
          allocBySku.set(
            a.productCode,
            (allocBySku.get(a.productCode) ?? 0) + a.qty,
          );
        }
        const totalNeed = Array.from(needBySku.values()).reduce(
          (s, v) => s + v,
          0,
        );
        const totalAlloc = Array.from(needBySku.entries()).reduce(
          (s, [code, need]) => s + Math.min(allocBySku.get(code) ?? 0, need),
          0,
        );
        const allocStatus: 'full' | 'partial' | 'none' =
          totalNeed === 0
            ? 'none'
            : totalAlloc >= totalNeed
              ? 'full'
              : totalAlloc > 0
                ? 'partial'
                : 'none';

        return {
          id: o.id,
          pkNo: o.pkNo,
          shipDate: o.shipDate,
          status: o.status,
          qrPrintFlag: o.qrPrintFlag,
          invoiceNo: o.invoiceNo,
          destName: o.destName,
          carrier: o.carrier,
          itemCount: o.items.length,
          scannedRatio:
            o.items.length === 0
              ? 0
              : Math.round(
                  (o.items.filter((it) => it.forceOk || it.scannedQty >= it.qty)
                    .length /
                    o.items.length) *
                    100,
                ),
          // 引当 KPI
          allocStatus,
          allocatedQty: totalAlloc,
          requiredQty: totalNeed,
          deletedAt: o.deletedAt,
        };
      }),
      total,
      page,
      limit,
    },
    message: 'OK',
  });
}
