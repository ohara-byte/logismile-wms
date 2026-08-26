/**
 * POST /api/handy/receiving-inspect
 *
 * ハンディ「発送日別 受入検品」の記録。
 *  Body: { shipDate: "YYYY-MM-DD", productCode, inspectedQty, pattern?, mode? }
 *  - inspection_count の StockMovement を ship_date + inspectedQty 付きで記録（qtyDelta=0＝在庫プールは触らない）。
 *  - 検品照合グリッド④⑧の集計元。認証: admin/manager/staff。
 *
 *  ★ mode（2026-08-26・現場要望「改修要望書」B案）
 *    'add' … 加算。既存行を消さず1行追加する（検品済み数 = 行の inspectedQty 合計）。
 *            画面の「追加」ボタン。複数ハンディの同時検品・不足分の追加運搬で
 *            先の検品数が消える事故を防ぐ。日常運用はこちら。
 *    'set' … 上書き。同一(発送日×商品×パターン)を洗い替えて1件にする。
 *            画面の「訂正」ボタン。誤入力を正すときだけ使う。従来の挙動。
 *
 *    ※ 消費側（inspection-grid / confirm-diff / pick-list / factory snapshot）は
 *      いずれも groupBy の _sum: inspectedQty で集計しているため、
 *      行を足すだけで加算が成立する（集計側の変更は不要）。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC } from '@/lib/date-utils';

const Body = z.object({
  shipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'shipDate は YYYY-MM-DD 形式'),
  productCode: z.string().min(1).max(20),
  inspectedQty: z.number().int().min(0),
  /** 納品パターン。'prev'=前々日前日納品分(④)／'today'=当日納品分(⑧)。既定 prev（現場運用の主。既存はtoday扱い）。 */
  pattern: z.enum(['prev', 'today']).default('prev'),
  /**
   * 記録方法。'add'=加算（既定・画面の「追加」）／'set'=上書き（画面の「訂正」）。
   * 既定を 'add' にしているのは、呼び出し側が指定を忘れたときに
   * 「先の検品数を消す」ほうへ倒れないようにするため（安全側）。
   */
  mode: z.enum(['add', 'set']).default('add'),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const shipDate = parseDateAsUTC(parsed.data.shipDate);
  if (!shipDate) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な発送日: ${parsed.data.shipDate}` },
      { status: 422 },
    );
  }

  // 商品実在チェック（Stock 行が無くても登録できるよう Product で確認）
  const product = await prisma.product.findUnique({
    where: { code: parsed.data.productCode },
    select: { code: true },
  });
  if (!product) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `未登録商品: ${parsed.data.productCode}` },
      { status: 422 },
    );
  }

  // 納品パターンを refType で表現：'receiving_prev'（前々日前日=④）/ 'receiving_today'（当日=⑧）。
  //   検品照合グリッドは「検品時刻」ではなく「このパターン」で ④/⑧ に振り分ける。
  const pattern = parsed.data.pattern;
  const refType = pattern === 'today' ? 'receiving_today' : 'receiving_prev';
  // 洗い替え対象：同一(発送日×商品×パターン)を置き換え。today は旧 'receiving'（当日扱い）も統合削除。
  const delRefTypes = pattern === 'today' ? ['receiving_today', 'receiving'] : ['receiving_prev'];
  const patLabel = pattern === 'today' ? '当日納品分' : '前日納品分';

  const mode = parsed.data.mode;

  // 加算では 0 は何も足さない＝操作ミスの可能性が高いので弾く。
  //   上書き（訂正）では 0 を許可する（検品数を 0 に戻す正当な操作）。
  if (mode === 'add' && parsed.data.inspectedQty === 0) {
    return NextResponse.json(
      { error: 'VALIDATION', message: '追加する数量は 1 以上で入力してください' },
      { status: 422 },
    );
  }

  const totalQty = await prisma.$transaction(async (tx) => {
    // 上書き（訂正）のときだけ洗い替える。加算は既存行を残したまま1行足す。
    if (mode === 'set') {
      await tx.stockMovement.deleteMany({
        where: {
          productCode: parsed.data.productCode,
          type: 'inspection_count',
          refType: { in: delRefTypes },
          shipDate,
        },
      });
    }
    // Stock 行が無いと FK で失敗するため upsert（qty は触らない）
    await tx.stock.upsert({
      where: { productCode: parsed.data.productCode },
      create: { productCode: parsed.data.productCode, qty: 0, allocatedQty: 0 },
      update: {},
    });
    await tx.stockMovement.create({
      data: {
        productCode: parsed.data.productCode,
        type: 'inspection_count',
        qtyDelta: 0, // 発送日別受入検品は在庫プールを触らない（引当・在庫はサイレント）
        inspectedQty: parsed.data.inspectedQty,
        shipDate,
        refType,
        note:
          mode === 'add'
            ? `発送日別受入検品(${patLabel}) ${parsed.data.shipDate} 追加+${parsed.data.inspectedQty}`
            : `発送日別受入検品(${patLabel}) ${parsed.data.shipDate} 訂正=${parsed.data.inspectedQty}`,
        createdBy: guard.auth.staffCode ?? null,
      },
    });
    // 画面に返す検品済み数は「合計」。消費側（グリッド等）と同じ集計軸で数える。
    const agg = await tx.stockMovement.aggregate({
      where: {
        productCode: parsed.data.productCode,
        type: 'inspection_count',
        refType: { in: delRefTypes },
        shipDate,
      },
      _sum: { inspectedQty: true },
    });
    return agg._sum.inspectedQty ?? 0;
  });

  return NextResponse.json({
    data: {
      shipDate: parsed.data.shipDate,
      productCode: parsed.data.productCode,
      /** 今回の入力値（加算なら加えた数、訂正なら設定した数） */
      inspectedQty: parsed.data.inspectedQty,
      /** 反映後の検品済み数（合計）。画面はこれを表示する。 */
      totalQty,
      mode,
    },
    message: 'OK',
  });
}
