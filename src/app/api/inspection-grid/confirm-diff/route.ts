/**
 * POST /api/inspection-grid/confirm-diff   body: { date: "YYYY-MM-DD" }
 *
 * 検品照合グリッドの「この発送日の差分を確定してCraftSmileへ送信」。
 *   対象＝発送日×商品の「前々日前日納品分の差分（③-④）」のうち、
 *        **検品済み（④>0）かつ 差分あり（③≠④）** の商品のみ。
 *   → 検品していない商品（④=0）は送らない（CraftSmile 納品データを正として据置＝【重要】）。
 *
 * 集計は inspection-grid の ③④（前2日）と同一ロジック。送信は notifyInspectionDiff。
 * 認証: admin / manager（送信＝書き込み系）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC } from '@/lib/date-utils';
import { fetchLiveShipPlan } from '@/lib/integration/factory-ship-plan-pull';
import { notifyInspectionDiff, type InspectionDiffItem } from '@/lib/integration/factory-notify';

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 検品パターン。'prev'=前々日前日納品(③④)／'today'=当日納品(⑦⑧)。既定 prev（後方互換）。 */
  pattern: z.enum(['prev', 'today']).default('prev'),
  /** 送信対象の商品コード（グリッドで選択した行）。未指定/空なら「検品済み＋差分あり」全件。 */
  productCodes: z.array(z.string().min(1).max(20)).optional(),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }
  const ymd = parsed.data.date;
  const pattern = parsed.data.pattern;
  const selectedCodes = parsed.data.productCodes;
  const shipDateUTC = parseDateAsUTC(ymd);
  if (!shipDateUTC) {
    return NextResponse.json({ error: 'VALIDATION', message: `不正な発送日: ${ymd}` }, { status: 422 });
  }

  // createdAt(入庫日/検品日)は JST 壁時計で日割り。
  //   前々日前日(prev)＝[prevStart, dayStart)／当日(today)＝[dayStart, dayEnd)。
  const dayStart = new Date(ymd);
  dayStart.setHours(0, 0, 0, 0);
  const prevStart = new Date(dayStart);
  prevStart.setDate(prevStart.getDate() - 2);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const winStart = pattern === 'today' ? dayStart : prevStart;
  const winEnd = pattern === 'today' ? dayEnd : dayStart;

  // 母集合＝クラフトスマイル由来（ライブpull・不達時 FactoryShipPlan）
  const live = await fetchLiveShipPlan(ymd);
  let codes: string[];
  if (live && live.length > 0) {
    codes = live.map((p) => p.productCode);
  } else {
    const plans = await prisma.factoryShipPlan.findMany({
      where: { shipDate: shipDateUTC },
      select: { productCode: true },
    });
    codes = plans.map((p) => p.productCode);
  }
  // グリッドで選択した行があればそれに限定（②：途中まで検品→選んだ行だけ送信）。
  if (selectedCodes && selectedCodes.length > 0) {
    const sel = new Set(selectedCodes);
    codes = codes.filter((c) => sel.has(c));
  }
  if (codes.length === 0) {
    return NextResponse.json({ data: { shipDate: ymd, sent: 0, items: [], dryRun: null }, message: '対象商品なし' });
  }

  // アクティブパターンの納品(inbound)／検品(inspection_count・受入検品)を該当時間窓で集計。
  //   prev: [prevStart, dayStart)＝③④／today: [dayStart, dayEnd)＝⑦⑧
  const [inbound, insp] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ['productCode'],
      where: { productCode: { in: codes }, type: 'inbound', shipDate: shipDateUTC, createdAt: { gte: winStart, lt: winEnd } },
      _sum: { qtyDelta: true },
    }),
    prisma.stockMovement.groupBy({
      by: ['productCode'],
      where: { productCode: { in: codes }, type: 'inspection_count', shipDate: shipDateUTC, createdAt: { gte: winStart, lt: winEnd } },
      _sum: { inspectedQty: true },
    }),
  ]);
  const deliveredBy = new Map(inbound.map((r) => [r.productCode, r._sum.qtyDelta ?? 0]));
  const inspectedBy = new Map(insp.map((r) => [r.productCode, r._sum.inspectedQty ?? 0]));

  // 送信対象＝検品済み(>0) かつ 差分あり。未検品(=0)は除外＝CraftSmile納品データが正。
  const items: InspectionDiffItem[] = [];
  for (const code of codes) {
    const declared = deliveredBy.get(code) ?? 0; // ③ or ⑦
    const inspected = inspectedBy.get(code) ?? 0; // ④ or ⑧
    if (inspected > 0 && declared !== inspected) {
      items.push({ productCode: code, qtyDeclared: declared, qtyInspected: inspected, qtyDiff: inspected - declared });
    }
  }

  if (items.length === 0) {
    return NextResponse.json({ data: { shipDate: ymd, sent: 0, items: [], dryRun: null }, message: '送信対象の差分はありません（検品済みかつ差分あり＝0件）' });
  }

  const result = await notifyInspectionDiff({
    shipDate: ymd,
    inspectedAt: new Date().toISOString(),
    inspectedBy: guard.auth.staffCode ?? 'wms',
    pattern,
    items,
  });

  if (!result.ok) {
    return NextResponse.json({ data: null, message: result.message, error: 'NOTIFY_FAILED' }, { status: 502 });
  }

  return NextResponse.json({
    data: {
      shipDate: ymd,
      sent: items.length,
      dryRun: result.dryRun,
      additionalDeliveryRequired: result.additionalDeliveryRequired ?? null,
      items,
    },
    message: result.dryRun ? `DRY-RUN（実送信なし・対象${items.length}件）` : `送信しました（${items.length}件）`,
  });
}
