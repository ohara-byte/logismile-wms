/**
 * GET /api/reports/daily-alloc-diff?date=YYYY-MM-DD
 *
 * Sprint Z-5: 業務終了時の引当差分確認レポート。
 *
 * 出力カテゴリ：
 *  1. 伝票未引当：必要数 > 引当数 の伝票一覧（出荷予定があるのに引当不足）
 *  2. 出荷後過不足：packed/shipped かつ scannedQty != qty の品目（強制OK 含む）
 *  3. 余剰在庫：当日入庫（納品/在庫検品）があり消費されず残った繰越なし品（通過型・受注生産）
 *  4. 検品済 reserved：packed なのに Allocation が reserved のまま残っている異常
 *
 * 認証: admin/manager
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC, addDaysUTC, todayJstAsUTC, formatDateYmd } from '@/lib/date-utils';

const Query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const parsed = Query.safeParse({
    date: searchParams.get('date') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: parsed.error.issues.map((i) => i.message).join(', '),
      },
      { status: 422 },
    );
  }

  // 日付根治(2026-07-02): shipDate(@db.Date)は UTC 真夜中、createdAt(タイムスタンプ)は JST 壁時計の当日。
  const ymd = parsed.data.date ?? formatDateYmd(todayJstAsUTC());
  const targetDate = parseDateAsUTC(ymd) ?? todayJstAsUTC();
  const nextDate = addDaysUTC(targetDate, 1);
  // 当日入庫(createdAt)は JST の当日で照会（@db.Date ではないため UTC 真夜中では 9h ずれる）。
  const createdFrom = new Date(ymd);
  createdFrom.setHours(0, 0, 0, 0);
  const createdTo = new Date(createdFrom);
  createdTo.setDate(createdTo.getDate() + 1);

  // 当日の全 ShippingOrder（削除除外）
  const orders = await prisma.shippingOrder.findMany({
    where: {
      shipDate: { gte: targetDate, lt: nextDate },
      deletedAt: null,
    },
    include: {
      items: {
        include: { product: { select: { name: true, productType: true } } },
      },
      allocations: { select: { qty: true, status: true, productCode: true } },
    },
  });

  // (1) 伝票未引当：必要数 > 引当数（released 除く）
  const unallocatedOrders: Array<{
    pkNo: string;
    destName: string | null;
    status: string;
    requiredQty: number;
    allocatedQty: number;
    diff: number;
    skus: Array<{
      productCode: string;
      productName: string;
      productType: string;
      requiredQty: number;
      allocatedQty: number;
      diff: number;
    }>;
  }> = [];
  for (const o of orders) {
    if (o.status === 'packed' || o.status === 'shipped') continue;
    const required = o.items.reduce((s, it) => s + it.qty, 0);
    const allocated = o.allocations
      .filter((a) => a.status !== 'released')
      .reduce((s, a) => s + a.qty, 0);
    if (allocated >= required) continue;

    // SKU 別差分
    const allocBySku = new Map<string, number>();
    for (const a of o.allocations) {
      if (a.status === 'released') continue;
      allocBySku.set(
        a.productCode,
        (allocBySku.get(a.productCode) ?? 0) + a.qty,
      );
    }
    const skus = o.items
      .map((it) => {
        const got = allocBySku.get(it.productCode) ?? 0;
        const diff = Math.max(it.qty - got, 0);
        return diff > 0
          ? {
              productCode: it.productCode,
              productName: it.product.name,
              productType: it.product.productType,
              requiredQty: it.qty,
              allocatedQty: got,
              diff,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    unallocatedOrders.push({
      pkNo: o.pkNo,
      destName: o.destName,
      status: o.status,
      requiredQty: required,
      allocatedQty: allocated,
      diff: required - allocated,
      skus,
    });
  }

  // (2) 出荷後過不足：packed/shipped で scannedQty < qty (forceOk 除く / 含む別カウント)
  const postShipDiffs: Array<{
    pkNo: string;
    destName: string | null;
    status: string;
    items: Array<{
      productCode: string;
      productName: string;
      qty: number;
      scannedQty: number;
      diff: number;
      forceOk: boolean;
    }>;
  }> = [];
  for (const o of orders) {
    if (o.status !== 'packed' && o.status !== 'shipped') continue;
    const issues = o.items
      .filter((it) => it.scannedQty !== it.qty)
      .map((it) => ({
        productCode: it.productCode,
        productName: it.product.name,
        qty: it.qty,
        scannedQty: it.scannedQty,
        diff: it.scannedQty - it.qty, // マイナス=不足 / プラス=超過
        forceOk: it.forceOk,
      }));
    if (issues.length > 0) {
      postShipDiffs.push({
        pkNo: o.pkNo,
        destName: o.destName,
        status: o.status,
        items: issues,
      });
    }
  }

  // (3) 余剰在庫：当日 入庫（工場納品 inbound / 在庫検品 inspection_count）があり、
  //     消費されずに残っている「繰越なし品（通過型・受注生産）」。
  //     在庫型（warehouse）は翌日繰越が前提なので余剰処理の対象外。
  const movements = await prisma.stockMovement.findMany({
    where: {
      type: { in: ['inbound', 'inspection_count'] },
      createdAt: { gte: createdFrom, lt: createdTo },
    },
    select: { productCode: true, qtyDelta: true },
  });
  const addedByCode = new Map<string, number>();
  for (const m of movements) {
    addedByCode.set(
      m.productCode,
      (addedByCode.get(m.productCode) ?? 0) + m.qtyDelta,
    );
  }
  // 該当 SKU について Stock 残（qty - allocatedQty）が残っているか
  const codes = Array.from(addedByCode.keys());
  let surplus: Array<{
    productCode: string;
    productName: string;
    productType: string;
    addedToday: number;
    remainingQty: number;
    availableQty: number;
  }> = [];
  if (codes.length > 0) {
    const stocks = await prisma.stock.findMany({
      where: { productCode: { in: codes } },
    });
    const products = await prisma.product.findMany({
      where: { code: { in: codes } },
      select: { code: true, name: true, productType: true },
    });
    const productByCode = new Map(products.map((p) => [p.code, p]));
    surplus = stocks
      .map((s) => {
        const p = productByCode.get(s.productCode);
        // 繰越なし品（通過型・受注生産）のみ。在庫型は翌日繰越のため除外。
        if (!p || p.productType === 'warehouse') return null;
        const addedToday = addedByCode.get(s.productCode) ?? 0;
        const available = Math.max(s.qty - s.allocatedQty, 0);
        if (available <= 0) return null;
        return {
          productCode: s.productCode,
          productName: p.name ?? s.productCode,
          productType: p.productType,
          addedToday,
          remainingQty: s.qty,
          availableQty: available,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }

  // (4) 検品済 reserved：packed なのに Allocation が reserved のまま（fulfilled 化漏れ）
  const stuckReserved: Array<{
    pkNo: string;
    productCode: string;
    qty: number;
    status: string;
  }> = [];
  for (const o of orders) {
    if (o.status !== 'packed' && o.status !== 'shipped') continue;
    for (const a of o.allocations) {
      if (a.status === 'reserved') {
        stuckReserved.push({
          pkNo: o.pkNo,
          productCode: a.productCode,
          qty: a.qty,
          status: a.status,
        });
      }
    }
  }

  return NextResponse.json({
    data: {
      targetDate: targetDate.toISOString().slice(0, 10),
      summary: {
        unallocatedOrderCount: unallocatedOrders.length,
        postShipDiffCount: postShipDiffs.length,
        surplusSkuCount: surplus.length,
        stuckReservedCount: stuckReserved.length,
      },
      unallocatedOrders,
      postShipDiffs,
      surplus,
      stuckReserved,
    },
    message: 'OK',
  });
}
