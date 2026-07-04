/**
 * GET /api/handy/pick-list?shipDate=YYYY-MM-DD
 *
 * ハンディ「発送日別 受入検品」用のピックリスト。
 *  指定発送日にクラフトスマイルから来る予定の商品（FactoryShipPlan）と、
 *  WMS 実績（納品=inbound / 既検品=inspection_count[receiving]）を返す。
 *  認証: admin/manager/staff（モバイル含む）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC, todayJstAsUTC, formatDateYmd } from '@/lib/date-utils';
import { fetchLiveShipPlan } from '@/lib/integration/factory-ship-plan-pull';

const Query = z.object({
  shipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const parsed = Query.safeParse({ shipDate: searchParams.get('shipDate') ?? undefined });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const ymd = parsed.data.shipDate ?? formatDateYmd(todayJstAsUTC());
  const shipDate = parseDateAsUTC(ymd);
  if (!shipDate) {
    return NextResponse.json({ error: 'VALIDATION', message: `不正な発送日: ${ymd}` }, { status: 422 });
  }

  // ①②・製造部署（母集合）：まず CraftSmile からライブ取得（検品照合グリッドと同じ経路・
  //   push 待ち不要で常に最新）。連携未設定/不達時のみ FactoryShipPlan（push キャッシュ）へフォールバック。
  type PlanRow = {
    productCode: string;
    productName: string | null;
    productionDeptName: string | null;
    plannedQty: number;
    confirmedQty: number | null;
  };
  const live = await fetchLiveShipPlan(ymd);
  let plans: PlanRow[];
  if (live && live.length > 0) {
    plans = live.map((p) => ({
      productCode: p.productCode,
      productName: p.productName,
      productionDeptName: p.productionDeptName,
      plannedQty: p.plannedQty,
      confirmedQty: p.confirmedQty,
    }));
  } else {
    plans = await prisma.factoryShipPlan.findMany({
      where: { shipDate },
      select: {
        productCode: true,
        productName: true,
        productionDeptName: true,
        plannedQty: true,
        confirmedQty: true,
      },
      orderBy: [{ productionDeptName: 'asc' }, { productCode: 'asc' }],
    });
  }

  if (plans.length === 0) {
    return NextResponse.json({ data: { shipDate: ymd, items: [] }, message: 'OK' });
  }

  const codes = plans.map((p) => p.productCode);
  const [delivered, inspected] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ['productCode'],
      where: { productCode: { in: codes }, type: 'inbound', shipDate },
      _sum: { qtyDelta: true },
    }),
    prisma.stockMovement.groupBy({
      by: ['productCode'],
      where: { productCode: { in: codes }, type: 'inspection_count', refType: 'receiving', shipDate },
      _sum: { inspectedQty: true },
    }),
  ]);
  const deliveredBy = new Map(delivered.map((d) => [d.productCode, d._sum.qtyDelta ?? 0]));
  const inspectedBy = new Map(inspected.map((d) => [d.productCode, d._sum.inspectedQty ?? 0]));

  const items = plans.map((p) => ({
    productCode: p.productCode,
    productName: p.productName,
    productionDeptName: p.productionDeptName,
    plannedQty: p.plannedQty,
    confirmedQty: p.confirmedQty,
    deliveredQty: deliveredBy.get(p.productCode) ?? 0,
    inspectedQty: inspectedBy.get(p.productCode) ?? 0,
  }));
  // ライブpull由来は未ソートのため、部署→商品コードで整列（表示順の安定）
  items.sort(
    (a, b) =>
      (a.productionDeptName ?? 'zzz').localeCompare(b.productionDeptName ?? 'zzz') ||
      a.productCode.localeCompare(b.productCode),
  );

  return NextResponse.json({ data: { shipDate: ymd, items }, message: 'OK' });
}
