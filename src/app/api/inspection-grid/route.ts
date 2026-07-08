/**
 * GET /api/inspection-grid?date=YYYY-MM-DD
 *
 * 検品照合グリッド（発送日 × 製造部署 × 種別）。Excel「検品照合」準拠。
 *  母集合＝クラフトスマイル由来 FactoryShipPlan（その発送日の 発送予定/18時確定/製造部署）。
 *  WMS 実績（納品=inbound / 検品=inspection_count）を StockMovement から集計して突合する。
 *  ※ 引当(Allocation)・在庫(Stock)は参照しない（通過型と同じくサイレント）。
 *
 * 列:
 *  ① plannedQty        発送予定数（FactoryShipPlan）
 *  ② confirmedQty      18時確定数（FactoryShipPlan・null=未確定）
 *  ③ prevDelivered     前日前々日納品数（inbound・ship_date一致・入庫日=発送日の前2日）
 *  ④ prevInspected     検品数（前日前々日・inspection_count・入庫日基準）
 *  ⑤ prevDiff          ③-④
 *  ⑥ confirmedShortage ②-④（確定締不足）
 *  ⑦ todayDelivered    当日納品数（inbound・ship_date一致・入庫日=発送日当日）
 *  ⑧ todayInspected    当日検品数（inspection_count・入庫日当日）
 *  ⑨ todayDiff         ⑦-⑧
 *  totalInspected=④+⑧ / totalDelivered=③+⑦ / balance=納品合計-検品合計
 *
 * 日付規約: ship_date は @db.Date=UTC真夜中で照会。createdAt(タイムスタンプ)は JST 壁時計で日割り。
 * 認証: admin/manager/lead 閲覧可（master_view）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/auth/permissions';
import { parseDateAsUTC, todayJstAsUTC, formatDateYmd } from '@/lib/date-utils';
import { fetchLiveShipPlan } from '@/lib/integration/factory-ship-plan-pull';

const Query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

type GridRow = {
  productCode: string;
  productName: string | null;
  productType: string | null;
  productionDeptCode: string | null;
  productionDeptName: string | null;
  plannedQty: number;
  confirmedQty: number | null;
  prevDelivered: number;
  prevInspected: number;
  prevDiff: number;
  confirmedShortage: number | null;
  todayDelivered: number;
  todayInspected: number;
  todayDiff: number;
  totalInspected: number;
  totalDelivered: number;
  balance: number;
};

export async function GET(req: Request) {
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const parsed = Query.safeParse({ date: searchParams.get('date') ?? undefined });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const ymd = parsed.data.date ?? formatDateYmd(todayJstAsUTC());
  const shipDateUTC = parseDateAsUTC(ymd);
  if (!shipDateUTC) {
    return NextResponse.json({ error: 'VALIDATION', message: `不正な発送日: ${ymd}` }, { status: 422 });
  }

  // createdAt(入庫日/検品日)は JST 壁時計で日割り。発送日当日=[dayStart, dayEnd)、前日前々日=[prevStart, dayStart)。
  const dayStart = new Date(ymd);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const prevStart = new Date(dayStart);
  prevStart.setDate(prevStart.getDate() - 2);

  // ①②・製造部署（母集合）。まずクラフトスマイルからライブ取得（リアル連携＝push待ち不要で常に最新）、
  //   連携未設定/不達時は FactoryShipPlan（push キャッシュ）にフォールバックする。
  type PlanRow = {
    productCode: string;
    productName: string | null;
    productionDeptCode: string | null;
    productionDeptName: string | null;
    plannedQty: number;
    confirmedQty: number | null;
  };
  const live = await fetchLiveShipPlan(ymd);
  let plans: PlanRow[];
  let planSource: 'live' | 'cache';
  if (live && live.length > 0) {
    plans = live;
    planSource = 'live';
  } else {
    plans = await prisma.factoryShipPlan.findMany({
      where: { shipDate: shipDateUTC },
      select: {
        productCode: true,
        productName: true,
        productionDeptCode: true,
        productionDeptName: true,
        plannedQty: true,
        confirmedQty: true,
      },
    });
    planSource = 'cache';
  }

  if (plans.length === 0) {
    return NextResponse.json({
      data: { shipDate: ymd, depts: [], typeCounts: {}, total: emptyTotal(), planSource },
      message: 'OK',
    });
  }

  const productCodes = plans.map((p) => p.productCode);

  // 種別（WMS Product.productType）
  const products = await prisma.product.findMany({
    where: { code: { in: productCodes } },
    select: { code: true, productType: true, name: true },
  });
  const typeByCode = new Map(products.map((p) => [p.code, p.productType]));
  const wmsNameByCode = new Map(products.map((p) => [p.code, p.name]));

  // ③⑦ 納品（inbound・ship_date一致・入庫日で前2日/当日に分割）
  const [prevInbound, todayInbound] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ['productCode'],
      where: {
        productCode: { in: productCodes },
        type: 'inbound',
        shipDate: shipDateUTC,
        createdAt: { gte: prevStart, lt: dayStart },
      },
      _sum: { qtyDelta: true },
    }),
    prisma.stockMovement.groupBy({
      by: ['productCode'],
      where: {
        productCode: { in: productCodes },
        type: 'inbound',
        shipDate: shipDateUTC,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: { qtyDelta: true },
    }),
  ]);

  // ④⑧ 検品（発送日別 受入検品）：ハンディで選んだ「納品パターン」で ④/⑧ を振り分ける。
  //   ④前日前々日検品 = refType='receiving_prev' ／ ⑧当日検品 = refType IN ('receiving_today','receiving')。
  //   ※「検品した時刻(createdAt)」では振り分けない（前日納品分を当日検品しても④に載るようにするため）。
  //     旧 'receiving'（パターン未指定の既存データ）は後方互換で当日(⑧)扱い。
  const [prevInsp, todayInsp] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ['productCode'],
      where: {
        productCode: { in: productCodes },
        type: 'inspection_count',
        shipDate: shipDateUTC,
        refType: 'receiving_prev',
      },
      _sum: { inspectedQty: true },
    }),
    prisma.stockMovement.groupBy({
      by: ['productCode'],
      where: {
        productCode: { in: productCodes },
        type: 'inspection_count',
        shipDate: shipDateUTC,
        refType: { in: ['receiving_today', 'receiving'] },
      },
      _sum: { inspectedQty: true },
    }),
  ]);

  const sumMap = (rows: { productCode: string; _sum: { qtyDelta: number | null } }[]) =>
    new Map(rows.map((r) => [r.productCode, r._sum.qtyDelta ?? 0]));
  const inspSumMap = (rows: { productCode: string; _sum: { inspectedQty: number | null } }[]) =>
    new Map(rows.map((r) => [r.productCode, r._sum.inspectedQty ?? 0]));
  const prevDelById = sumMap(prevInbound);
  const todayDelById = sumMap(todayInbound);
  const prevInspById = inspSumMap(prevInsp);
  const todayInspById = inspSumMap(todayInsp);

  const rows: GridRow[] = plans.map((p) => {
    const prevDelivered = prevDelById.get(p.productCode) ?? 0;
    const todayDelivered = todayDelById.get(p.productCode) ?? 0;
    const prevInspected = prevInspById.get(p.productCode) ?? 0;
    const todayInspected = todayInspById.get(p.productCode) ?? 0;
    const totalInspected = prevInspected + todayInspected;
    const totalDelivered = prevDelivered + todayDelivered;
    return {
      productCode: p.productCode,
      productName: p.productName ?? wmsNameByCode.get(p.productCode) ?? null,
      productType: typeByCode.get(p.productCode) ?? null,
      productionDeptCode: p.productionDeptCode,
      productionDeptName: p.productionDeptName,
      plannedQty: p.plannedQty,
      confirmedQty: p.confirmedQty,
      prevDelivered,
      prevInspected,
      prevDiff: prevDelivered - prevInspected,
      confirmedShortage: p.confirmedQty == null ? null : p.confirmedQty - totalInspected,
      todayDelivered,
      todayInspected,
      todayDiff: todayDelivered - todayInspected,
      totalInspected,
      totalDelivered,
      balance: totalDelivered - totalInspected,
    };
  });

  // 製造部署ごとにグルーピング（部署コード→行）
  const deptMap = new Map<string, { deptCode: string | null; deptName: string | null; rows: GridRow[] }>();
  for (const r of rows) {
    const key = r.productionDeptCode ?? '__none__';
    let g = deptMap.get(key);
    if (!g) {
      g = { deptCode: r.productionDeptCode, deptName: r.productionDeptName, rows: [] };
      deptMap.set(key, g);
    }
    g.rows.push(r);
  }
  const depts = Array.from(deptMap.values()).map((g) => ({
    deptCode: g.deptCode,
    deptName: g.deptName,
    rows: g.rows.sort((a, b) => a.productCode.localeCompare(b.productCode)),
    subtotal: sumRows(g.rows),
  }));
  depts.sort((a, b) => (a.deptName ?? 'zzz').localeCompare(b.deptName ?? 'zzz'));

  // 種別カウント（トグル用）
  const typeCounts: Record<string, number> = { all: rows.length };
  for (const r of rows) {
    const t = r.productType ?? 'unknown';
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }

  return NextResponse.json({
    data: { shipDate: ymd, depts, typeCounts, total: sumRows(rows), planSource },
    message: 'OK',
  });
}

function sumRows(rows: GridRow[]) {
  const t = emptyTotal();
  for (const r of rows) {
    t.plannedQty += r.plannedQty;
    t.confirmedQty += r.confirmedQty ?? 0;
    t.prevDelivered += r.prevDelivered;
    t.prevInspected += r.prevInspected;
    t.todayDelivered += r.todayDelivered;
    t.todayInspected += r.todayInspected;
    t.totalInspected += r.totalInspected;
    t.totalDelivered += r.totalDelivered;
  }
  t.prevDiff = t.prevDelivered - t.prevInspected;
  t.todayDiff = t.todayDelivered - t.todayInspected;
  t.balance = t.totalDelivered - t.totalInspected;
  t.skuCount = rows.length;
  return t;
}

function emptyTotal() {
  return {
    skuCount: 0,
    plannedQty: 0,
    confirmedQty: 0,
    prevDelivered: 0,
    prevInspected: 0,
    prevDiff: 0,
    todayDelivered: 0,
    todayInspected: 0,
    todayDiff: 0,
    totalInspected: 0,
    totalDelivered: 0,
    balance: 0,
  };
}
