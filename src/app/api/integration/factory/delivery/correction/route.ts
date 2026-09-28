/**
 * POST /api/integration/factory/delivery/correction
 *
 * 工場 → WMS 納品の**訂正**（数量修正・取り戻し）。小原様ご依頼 2026-09-28。
 *
 *   > 納品済みの商品が後で数相違が発覚、もしくは戻して欲しい。
 *   > 納品済み修正ボタンを追加し、数量修正と取り戻しのを選択し、加算・減算を出来るようしたい。
 *
 * 元の納品（`POST …/factory/delivery`）は `qty` が 1 以上の正の数しか
 * 受け取れず、**減らす口が無かった**。ここが訂正の入口になる。
 *
 * 仕様は元の納品と揃える：
 *   - HMAC 検証 ＋ Idempotency-Key 重複検出
 *   - factory_api モード時のみ動作（legacy では 503）
 *
 * 在庫の扱い（小原様確定 2026-09-28）：
 *   - **0 未満にしない。** 引ける分だけ引き、実際に適用した数を返す
 *   - 引当済み（allocatedQty）は見ない（2026-07-01 に撤去されたガードと同じ方針）
 *   - 増減は必ず `StockMovement`（type='factory_correction'）に残す
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isFactoryApiMode, isFactoryAutoInspectOk } from '@/lib/integration/factory-mode';
import {
  verifyFactoryRequest,
  checkIdempotency,
  rememberIdempotency,
} from '@/lib/integration/factory-auth';
import { reallocateForProduct } from '@/lib/allocation/reallocate-pending';
import { maskError } from '@/lib/api-errors';
import {
  CORRECTION_MOVEMENT_TYPE,
  CORRECTION_REF_TYPE,
  applicableDelta,
  correctionNote,
  parseCorrectionReason,
} from '@/lib/integration/delivery-correction';

const Body = z.object({
  /** 訂正自体の一意キー（冪等キーとは別に、増減ログの参照に使う） */
  correctionNo: z.string().min(1).max(40),
  /** 訂正対象の元の納品No（追跡用。WMS 側で存在チェックはしない） */
  originalDeliveryNo: z.string().min(1).max(30),
  correctedAt: z.string().datetime(),
  /** 区分。計算は変えず、表示とログにだけ使う */
  reason: z.enum(['qty_fix', 'return']),
  items: z
    .array(
      z.object({
        productCode: z.string().min(1).max(20),
        /**
         * 増減（＋は加算・−は減算）。0 は無意味なので拒否する。
         * ★ 元の納品 API と違い **負値を受け取れる**のがこの API の存在意義。
         */
        qtyDelta: z
          .number()
          .int()
          .refine((n) => n !== 0, { message: 'qtyDelta に 0 は指定できません' }),
        note: z.string().max(200).nullable().optional(),
      }),
    )
    .min(1),
  remarks: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  if (!isFactoryApiMode()) {
    return NextResponse.json(
      {
        data: null,
        message:
          '工場連携モードが有効ではありません（FACTORY_INTEGRATION_MODE=factory_api 設定時のみ有効）',
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

  // 同じ訂正が二度届いても在庫を二重に動かさない
  const idem = checkIdempotency(auth.idempotencyKey);
  if (idem.duplicate) {
    return NextResponse.json(idem.response, { status: 200 });
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

  try {
    const productCodes = Array.from(new Set(parsed.data.items.map((i) => i.productCode)));
    const products = await prisma.product.findMany({
      where: { code: { in: productCodes } },
      select: { code: true },
    });
    const known = new Set(products.map((p) => p.code));
    const unknownCodes = productCodes.filter((c) => !known.has(c));
    if (unknownCodes.length > 0) {
      return NextResponse.json(
        {
          data: null,
          message: `未登録商品: ${unknownCodes.join(', ')}`,
          error: 'VALIDATION',
        },
        { status: 422 },
      );
    }

    const reason = parseCorrectionReason(parsed.data.reason);

    const results = await prisma.$transaction(async (tx) => {
      const out: Array<{
        productCode: string;
        requestedDelta: number;
        appliedDelta: number;
        shortfall: number;
        stockQtyAfter: number;
      }> = [];

      for (const it of parsed.data.items) {
        // 在庫行が無い商品への減算は「引ける在庫が 0」＝何も引けない。
        //   行を作ってから詰めることで、以後の訂正・納品が同じ道筋になる。
        const before = await tx.stock.upsert({
          where: { productCode: it.productCode },
          create: { productCode: it.productCode, qty: 0, allocatedQty: 0 },
          update: {},
        });

        const { applied, shortfall } = applicableDelta(before.qty, it.qtyDelta);

        let after = before.qty;
        if (applied !== 0) {
          const updated = await tx.stock.update({
            where: { productCode: it.productCode },
            data: { qty: { increment: applied } },
          });
          after = updated.qty;

          await tx.stockMovement.create({
            data: {
              productCode: it.productCode,
              type: CORRECTION_MOVEMENT_TYPE,
              qtyDelta: applied,
              refType: CORRECTION_REF_TYPE,
              refId: parsed.data.correctionNo,
              note: correctionNote({
                correctionNo: parsed.data.correctionNo,
                originalDeliveryNo: parsed.data.originalDeliveryNo,
                reason,
                requestedDelta: it.qtyDelta,
                appliedDelta: applied,
                note: it.note ?? parsed.data.remarks ?? null,
              }),
            },
          });
        }

        out.push({
          productCode: it.productCode,
          requestedDelta: it.qtyDelta,
          appliedDelta: applied,
          shortfall,
          stockQtyAfter: after,
        });
      }
      return out;
    });

    // 在庫が増えた商品は引当し直す（元の納品 API と同じ条件でのみ）。
    //   減った場合は触らない。既存の引当を崩すより、検品締めでの再配分に委ねる。
    const allocResults: Array<{ productCode: string; allocated: number; shortage: number }> = [];
    if (isFactoryAutoInspectOk()) {
      for (const r of results) {
        if (r.appliedDelta <= 0) continue;
        const ar = await reallocateForProduct(r.productCode);
        allocResults.push({
          productCode: r.productCode,
          allocated: ar.allocated,
          shortage: ar.shortage,
        });
      }
    }

    const responseBody = {
      data: {
        correctionNo: parsed.data.correctionNo,
        originalDeliveryNo: parsed.data.originalDeliveryNo,
        reason,
        appliedAt: new Date().toISOString(),
        results: results.map((r) => {
          const a = allocResults.find((x) => x.productCode === r.productCode);
          return {
            productCode: r.productCode,
            requestedDelta: r.requestedDelta,
            /** 実際に在庫へ反映した増減（在庫不足で詰めた後） */
            appliedDelta: r.appliedDelta,
            /** 引ききれなかった数（>0 なら在庫が足りなかった） */
            shortfall: r.shortfall,
            stockQtyAfter: r.stockQtyAfter,
            allocated: a?.allocated ?? 0,
            shortage: a?.shortage ?? 0,
          };
        }),
      },
      message: 'OK',
      error: null,
    };

    rememberIdempotency(auth.idempotencyKey, responseBody);
    return NextResponse.json(responseBody);
  } catch (e) {
    return maskError(
      '[POST /api/integration/factory/delivery/correction]',
      e,
      'INTERNAL',
      500,
      '納品訂正の処理中に内部エラーが発生しました',
    );
  }
}
