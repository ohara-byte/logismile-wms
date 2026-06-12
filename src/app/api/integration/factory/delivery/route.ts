/**
 * POST /api/integration/factory/delivery
 *
 * Sprint Z-8: 工場 → WMS 納品データ受信。
 *  - HMAC 検証 + Idempotency-Key 重複検出
 *  - factory_api モード時のみ動作（legacy モードでは 503）
 *  - Stock.qty に加算 → 該当 SKU を含む未引当伝票へ自動再引当
 *
 * 詳細は デスクトップ「WMS_工場連携IF仕様書_v0.1.md」§3-2 参照。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { isFactoryApiMode } from '@/lib/integration/factory-mode';
import {
  verifyFactoryRequest,
  checkIdempotency,
  rememberIdempotency,
} from '@/lib/integration/factory-auth';
import { reallocateForProduct } from '@/lib/allocation/reallocate-pending';
import { maskError } from '@/lib/api-errors';
import { isFactoryAutoInspectOk } from '@/lib/integration/factory-mode';
import { notifyInspectionComplete } from '@/lib/integration/factory-notify';

const Body = z.object({
  deliveryNo: z.string().min(1).max(30),
  deliveredAt: z.string().datetime(),
  items: z
    .array(
      z.object({
        productCode: z.string().min(1).max(20),
        qty: z.number().int().min(1),
        lotNo: z.string().max(30).nullable().optional(),
        instructionNo: z.string().max(30).nullable().optional(),
        note: z.string().nullable().optional(),
        // ── v0.2 拡張（2026-06-01 製造側依頼 B1 / doc 13 §2-5-2）──
        /** 納品区分: warehouse=入庫保管 / passthrough=通過（必須） */
        deliveryType: z.enum(['warehouse', 'passthrough']),
        /** 賞味期限 YYYY-MM-DD（任意・賞味期限なし商品は null）。製造側は未設定時 null を送るため nullable。 */
        expiryDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'expiryDate は YYYY-MM-DD 形式')
          .nullable()
          .optional(),
        /** JAN コード（任意・突合は productCode で行う） */
        janCode: z.string().max(20).nullable().optional(),
        /** 発送可能賞味期限（日数・任意）。在庫検品バナー「入庫日+日数-1」の算出源（A・2026-06-12） */
        shippableExpiryDays: z.number().int().positive().nullable().optional(),
      }),
    )
    .min(1),
  remarks: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  // モードチェック（legacy なら受信不可）
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

  // HMAC 検証
  const auth = verifyFactoryRequest(req, rawBody);
  if (!auth.ok) {
    return NextResponse.json(
      { data: null, message: auth.message, error: 'AUTH' },
      { status: auth.status },
    );
  }

  // 冪等チェック
  const idem = checkIdempotency(auth.idempotencyKey);
  if (idem.duplicate) {
    return NextResponse.json(idem.response, { status: 200 });
  }

  // パース
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
    const productCodes = Array.from(
      new Set(parsed.data.items.map((i) => i.productCode)),
    );

    // 商品実在チェック
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

    // トランザクションで Stock 加算 + StockMovement + ManufacturingInstruction 状態更新
    const stockResults = await prisma.$transaction(async (tx) => {
      const out: Array<{
        productCode: string;
        qty: number;
        stockQtyAfter: number;
        instructionMatched: string | null;
      }> = [];

      for (const it of parsed.data.items) {
        // Stock 加算
        await tx.stock.upsert({
          where: { productCode: it.productCode },
          create: {
            productCode: it.productCode,
            qty: it.qty,
            allocatedQty: 0,
          },
          update: { qty: { increment: it.qty } },
        });

        const after = await tx.stock.findUnique({
          where: { productCode: it.productCode },
        });

        // A：発送可能賞味期限（日数）を商品マスタへ保存（在庫検品バナーの算出源）。
        //   毎回の納品で最新値に更新（null は更新しない＝既存値を温存）。
        if (it.shippableExpiryDays != null) {
          await tx.product.update({
            where: { code: it.productCode },
            data: { shippableExpiryDays: it.shippableExpiryDays },
          });
        }

        // v0.2 拡張フィールドをトレーサビリティとして note に集約（スキーマ移行なし）。
        //   例: "工場納品 D20260601-0001 (lot ...) [warehouse 期限2026-06-16 JAN4582000600001 発送可能30日]"
        const metaParts = [
          it.deliveryType,
          it.expiryDate ? `期限${it.expiryDate}` : null,
          it.janCode ? `JAN${it.janCode}` : null,
          it.shippableExpiryDays != null ? `発送可能${it.shippableExpiryDays}日` : null,
        ].filter(Boolean);
        const baseNote =
          it.note ??
          `工場納品 ${parsed.data.deliveryNo}${it.lotNo ? ` (lot ${it.lotNo})` : ''}`;
        await tx.stockMovement.create({
          data: {
            productCode: it.productCode,
            type: 'inbound',
            qtyDelta: it.qty,
            refType: 'factory_delivery',
            refId: parsed.data.deliveryNo,
            note: `${baseNote} [${metaParts.join(' ')}]`,
          },
        });

        // 製造指示があれば紐付け（producing → completed）
        if (it.instructionNo) {
          const mi = await tx.manufacturingInstruction.findUnique({
            where: { instructionNo: it.instructionNo },
          });
          if (mi && (mi.status === 'sent' || mi.status === 'producing')) {
            await tx.manufacturingInstruction.update({
              where: { id: mi.id },
              data: {
                status: 'completed',
                completedAt: new Date(parsed.data.deliveredAt),
              },
            });
          }
        }

        out.push({
          productCode: it.productCode,
          qty: it.qty,
          stockQtyAfter: after?.qty ?? it.qty,
          instructionMatched: it.instructionNo ?? null,
        });
      }
      return out;
    });

    // トランザクション後、該当 SKU の自動再引当を実行
    const allocResults: Array<{
      productCode: string;
      allocated: number;
      shortage: number;
    }> = [];
    for (const r of stockResults) {
      const ar = await reallocateForProduct(r.productCode);
      allocResults.push({
        productCode: r.productCode,
        allocated: ar.allocated,
        shortage: ar.shortage,
      });
    }

    const responseBody = {
      data: {
        deliveryNo: parsed.data.deliveryNo,
        appliedAt: new Date().toISOString(),
        results: stockResults.map((r) => {
          const a = allocResults.find((x) => x.productCode === r.productCode);
          return {
            productCode: r.productCode,
            qty: r.qty,
            stockQtyAfter: r.stockQtyAfter,
            allocated: a?.allocated ?? 0,
            shortage: a?.shortage ?? 0,
            instructionMatched: r.instructionMatched,
          };
        }),
      },
      message: 'OK',
    };

    // 受入＝検品OK（差分なし）：受信成立後、検品完了（申告=検品・差分0）を製造側へ自動通知。
    //   将来 WMS 側に受入検品工程を導入する際は FACTORY_AUTO_INSPECT_OK=false で本処理を停止する。
    //   DRY-RUN 中は notifyInspectionComplete 内で実送信せず log のみ。
    //   コールバック失敗は受入成立（在庫加算）には影響させない（非致命・log のみ）。
    if (isFactoryAutoInspectOk()) {
      try {
        await notifyInspectionComplete({
          deliveryNo: parsed.data.deliveryNo,
          inspectedAt: new Date().toISOString(),
          inspectedBy: 'auto-receipt',
          items: parsed.data.items.map((it) => ({
            productCode: it.productCode,
            qtyDeclared: it.qty,
            qtyInspected: it.qty, // 受入＝検品OK：申告数＝検品数（差分0）
            qtyDiff: 0,
          })),
        });
      } catch (e) {
        console.warn(
          `[factory/delivery] 受入検品OK 自動通知に失敗（受入は成立）: ${parsed.data.deliveryNo}: ${String(e)}`,
        );
      }
    }

    rememberIdempotency(auth.idempotencyKey, responseBody);
    return NextResponse.json(responseBody);
  } catch (e) {
    return maskError(
      '[POST /api/integration/factory/delivery]',
      e,
      'INTERNAL',
      500,
      '納品処理中に内部エラーが発生しました',
    );
  }
}
