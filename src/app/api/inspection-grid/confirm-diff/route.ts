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
  const shipDateUTC = parseDateAsUTC(ymd);
  if (!shipDateUTC) {
    return NextResponse.json({ error: 'VALIDATION', message: `不正な発送日: ${ymd}` }, { status: 422 });
  }

  // createdAt(入庫日/検品日)は JST 壁時計で日割り。前々日前日＝[prevStart, dayStart)。
  const dayStart = new Date(ymd);
  dayStart.setHours(0, 0, 0, 0);
  const prevStart = new Date(dayStart);
  prevStart.setDate(prevStart.getDate() - 2);

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
  if (codes.length === 0) {
    return NextResponse.json({ data: { shipDate: ymd, sent: 0, items: [], dryRun: null }, message: '対象商品なし' });
  }

  // ③前々日前日納品（inbound）／④検品（inspection_count・受入検品）
  const [prevInbound, prevInsp] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ['productCode'],
      where: { productCode: { in: codes }, type: 'inbound', shipDate: shipDateUTC, createdAt: { gte: prevStart, lt: dayStart } },
      _sum: { qtyDelta: true },
    }),
    prisma.stockMovement.groupBy({
      by: ['productCode'],
      where: { productCode: { in: codes }, type: 'inspection_count', shipDate: shipDateUTC, createdAt: { gte: prevStart, lt: dayStart } },
      _sum: { inspectedQty: true },
    }),
  ]);
  const deliveredBy = new Map(prevInbound.map((r) => [r.productCode, r._sum.qtyDelta ?? 0]));
  const inspectedBy = new Map(prevInsp.map((r) => [r.productCode, r._sum.inspectedQty ?? 0]));

  // 送信対象＝検品済み(④>0) かつ 差分あり(③≠④)。未検品(④=0)は除外＝CraftSmile納品データが正。
  const items: InspectionDiffItem[] = [];
  for (const code of codes) {
    const declared = deliveredBy.get(code) ?? 0; // ③
    const inspected = inspectedBy.get(code) ?? 0; // ④
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
