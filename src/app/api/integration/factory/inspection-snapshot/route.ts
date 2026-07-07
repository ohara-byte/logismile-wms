/**
 * GET /api/integration/factory/inspection-snapshot?shipDate=YYYY-MM-DD
 *
 * クラフトスマイル → WMS: ミラーリング照合用の「権威スナップショット」。
 *  指定発送日について、WMS が持つ真実を productCode ごとに返す：
 *    - delivered      : 納品(③) = StockMovement(type=inbound, shipDate) の qtyDelta 合計（プール実績）
 *    - inspected      : 検品(④) = StockMovement(type=inspection_count, refType=receiving, shipDate) の inspectedQty 合計
 *    - inspectionDone : 受入検品を実施したか（inspection_count 行が1件でもあるか）
 *    - inspectedAt    : 最終検品時刻
 *
 * CraftSmile はこれを pull して自分の WmsDelivery（伝票別）と突合し、
 *   ・実検品済みの商品は実④で更新
 *   ・未検品(inspectionDone=false)は CraftSmile 納品数を検品扱いにフォールバック（出荷を止めない）
 *   ・③(納品)の CraftSmile 合計 と WMS delivered の差異＝ドリフトを検知
 *
 * 認証: HMAC（factory 連携共通・verifyFactoryRequest / X-Factory-*）。GET は body 空で署名。
 *   canonical = `${ts}\n`（空 body）。Idempotency-Key ヘッダ必須（連携共通仕様）。
 * factory_api モード時のみ有効。読み取り専用（在庫・検品・出荷には一切干渉しない）。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isFactoryApiMode } from '@/lib/integration/factory-mode';
import { verifyFactoryRequest } from '@/lib/integration/factory-auth';
import { maskError } from '@/lib/api-errors';
import { parseDateAsUTC } from '@/lib/date-utils';

export async function GET(req: Request) {
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

  // GET は body 空。canonical = `${ts}\n` で検証（送信側も空 body で署名）。
  const rawBody = await req.text();
  const auth = verifyFactoryRequest(req, rawBody);
  if (!auth.ok) {
    return NextResponse.json(
      { data: null, message: auth.message, error: 'AUTH' },
      { status: auth.status },
    );
  }

  const { searchParams } = new URL(req.url);
  const ymd = searchParams.get('shipDate') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return NextResponse.json(
      { data: null, message: 'shipDate クエリ必須 (YYYY-MM-DD)', error: 'VALIDATION' },
      { status: 422 },
    );
  }
  const shipDate = parseDateAsUTC(ymd);
  if (!shipDate) {
    return NextResponse.json(
      { data: null, message: `不正な発送日: ${ymd}`, error: 'VALIDATION' },
      { status: 422 },
    );
  }

  try {
    const [inbound, inspected] = await Promise.all([
      prisma.stockMovement.groupBy({
        by: ['productCode'],
        where: { type: 'inbound', shipDate },
        _sum: { qtyDelta: true },
      }),
      prisma.stockMovement.groupBy({
        by: ['productCode'],
        where: { type: 'inspection_count', refType: 'receiving', shipDate },
        _sum: { inspectedQty: true },
        _max: { createdAt: true },
      }),
    ]);

    const deliveredBy = new Map(inbound.map((d) => [d.productCode, d._sum.qtyDelta ?? 0]));
    const inspectedBy = new Map(
      inspected.map((d) => [d.productCode, { qty: d._sum.inspectedQty ?? 0, at: d._max.createdAt }]),
    );

    const codes = new Set<string>([...deliveredBy.keys(), ...inspectedBy.keys()]);
    const items = [...codes]
      .map((productCode) => {
        const insp = inspectedBy.get(productCode);
        return {
          productCode,
          delivered: deliveredBy.get(productCode) ?? 0,
          inspected: insp?.qty ?? 0,
          inspectionDone: inspectedBy.has(productCode),
          inspectedAt: insp?.at ? insp.at.toISOString() : null,
        };
      })
      .sort((a, b) => a.productCode.localeCompare(b.productCode));

    return NextResponse.json({ data: { shipDate: ymd, items }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[GET /api/integration/factory/inspection-snapshot]',
      e,
      'INTERNAL',
      500,
      'inspection-snapshot 取得中に内部エラーが発生しました',
    );
  }
}
