/**
 * POST /api/integration/factory/ship-plan
 *
 * クラフトスマイル → WMS: 発送日ごとの「発送予定数(①)・18時確定数(②)・製造部署」スナップショット受信。
 *  - HMAC 検証（factory 連携共通・verifyFactoryRequest）
 *  - factory_api モード時のみ動作
 *  - 指定発送日の FactoryShipPlan を洗い替え（全削除→一括作成）＝ push のたびに最新へ差し替え
 *  - 検品照合グリッド（発送日×製造部署×種別）の基準値（①②・製造部署）として使用
 *
 * Body:
 *   { shipDate: "YYYY-MM-DD",
 *     items: [{ productCode, productName?, productionDeptCode?, productionDeptName?,
 *               plannedQty, confirmedQty? }] }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isFactoryApiMode } from '@/lib/integration/factory-mode';
import { verifyFactoryRequest } from '@/lib/integration/factory-auth';
import { maskError } from '@/lib/api-errors';
import { parseDateAsUTC } from '@/lib/date-utils';

const Body = z.object({
  shipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'shipDate は YYYY-MM-DD 形式'),
  items: z
    .array(
      z.object({
        productCode: z.string().min(1).max(20),
        productName: z.string().max(100).nullable().optional(),
        productionDeptCode: z.string().max(20).nullable().optional(),
        productionDeptName: z.string().max(40).nullable().optional(),
        plannedQty: z.number().int().min(0),
        confirmedQty: z.number().int().min(0).nullable().optional(),
      }),
    )
    .max(20000),
});

export async function POST(req: Request) {
  if (!isFactoryApiMode()) {
    return NextResponse.json(
      {
        data: null,
        message: '工場連携モードが有効ではありません（FACTORY_INTEGRATION_MODE=factory_api 設定時のみ有効）',
        error: 'MODE_DISABLED',
      },
      { status: 503 },
    );
  }

  const rawBody = await req.text();

  const auth = verifyFactoryRequest(req, rawBody);
  if (!auth.ok) {
    return NextResponse.json(
      { data: null, message: auth.message, error: 'AUTH' },
      { status: auth.status },
    );
  }

  let parsed;
  try {
    parsed = Body.safeParse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json(
      { data: null, message: '不正な JSON', error: 'VALIDATION' },
      { status: 400 },
    );
  }
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        message: parsed.error.issues.map((i) => i.message).join(', '),
        error: 'VALIDATION',
      },
      { status: 422 },
    );
  }

  // @db.Date と揃える UTC 真夜中（日付根治 2026-07-02 以降は暦日どおり）
  const shipDate = parseDateAsUTC(parsed.data.shipDate);
  if (!shipDate) {
    return NextResponse.json(
      { data: null, message: `不正な発送日: ${parsed.data.shipDate}`, error: 'VALIDATION' },
      { status: 422 },
    );
  }

  try {
    const count = await prisma.$transaction(async (tx) => {
      // 発送日単位で洗い替え（削除された商品も消える）
      await tx.factoryShipPlan.deleteMany({ where: { shipDate } });
      if (parsed.data.items.length === 0) return 0;
      // productCode 重複は最後を優先して一意化
      const byCode = new Map<string, (typeof parsed.data.items)[number]>();
      for (const it of parsed.data.items) byCode.set(it.productCode, it);
      const rows = Array.from(byCode.values()).map((it) => ({
        shipDate,
        productCode: it.productCode,
        productName: it.productName ?? null,
        productionDeptCode: it.productionDeptCode ?? null,
        productionDeptName: it.productionDeptName ?? null,
        plannedQty: it.plannedQty,
        confirmedQty: it.confirmedQty ?? null,
      }));
      const res = await tx.factoryShipPlan.createMany({ data: rows });
      return res.count;
    });

    return NextResponse.json({
      data: { shipDate: parsed.data.shipDate, upserted: count },
      message: 'OK',
    });
  } catch (e) {
    return maskError(
      '[POST /api/integration/factory/ship-plan]',
      e,
      'INTERNAL',
      500,
      'ship-plan 受信中に内部エラーが発生しました',
    );
  }
}
