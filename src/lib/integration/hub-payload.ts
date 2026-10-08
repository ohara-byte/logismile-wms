/**
 * HUB → LogiSmile の本文（2026-10-08）。
 *
 * Phase1 は田舎主義 → HUB → LogiSmile の中継（ohara 様確定 2026-10-07）。中身は現行の Thomas 出力
 * （「WMS出力項目」タブ＝mapping.ts の ORDER_CSV_COLUMNS 17 列 / PRODUCT_CSV_COLUMNS 5 列）そのもの。
 * HUB は田舎主義の値を**加工せずに**渡し、LogiSmile は CSV と同じ登録処理（thomas-import.ts）を通す。
 *
 * - 値はすべて文字列（CSV の 1 マスと同じ）。数量だけ整数
 * - 伝票（見出し＋明細）の形で受け、CSV と同じ「1 明細 = 1 行」に直す
 * - ★ 契約に無い項目は 422（.strict()）。項目を増やすときは HUB 側と同時に直す（WMS要望の列追加など）
 *
 * 熨斗フラグは田舎主義の値をそのまま `noshiFlag` に入れる。QR 印刷フラグへの読み替えは
 * LogiSmile 側（parseQrPrintFlag・QR 強制マスタ）で CSV と同じく行う。
 */

import { z } from 'zod';
import { ORDER_CSV_COLUMNS as O, PRODUCT_CSV_COLUMNS as P } from './mapping';
import type { ImportRowError } from './types';
import type { ThomasRow } from './thomas-import';

/** 1 回で受ける上限（CSV 取込の行数上限 THOMAS_CSV_MAX_ROWS の既定と同じ） */
export const HUB_MAX_ROWS = 20000;

const str = (max: number) => z.string().max(max);

const HubOrderItem = z
  .object({
    productCode: z.string().trim().min(1).max(20),
    productName: str(100).optional(),
    qty: z.number().int().min(0),
  })
  .strict();

export const HubOrder = z
  .object({
    pkNo: z.string().trim().min(1).max(30),
    shipDate: z.string().min(1).max(20),
    carrier: str(100),
    invoiceNo: str(30).optional(),
    customerCode: str(30).optional(),
    orderNo: str(30).optional(),
    destZip: str(8).optional(),
    destAddr: str(200).optional(),
    destName: str(100).optional(),
    noshiFlag: str(20).optional(),
    noshiCode: str(20).optional(),
    noshiName: str(50).optional(),
    noshiPerson: str(50).optional(),
    deliveryDate: str(20).optional(),
    items: z.array(HubOrderItem).min(1),
  })
  .strict();

export type HubOrder = z.infer<typeof HubOrder>;

export const HubOrdersBody = z
  .object({ orders: z.array(HubOrder).min(1) })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.orders.forEach((o, i) => {
      if (seen.has(o.pkNo)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['orders', i, 'pkNo'], message: `ピッキング№ ${o.pkNo} の伝票が 2 つあります` });
      }
      seen.add(o.pkNo);
    });
    const rows = body.orders.reduce((n, o) => n + o.items.length, 0);
    if (rows > HUB_MAX_ROWS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['orders'], message: `明細は 1 回 ${HUB_MAX_ROWS} 行までです（${rows} 行）` });
    }
  });

const HubProduct = z
  .object({
    code: z.string().trim().min(1).max(20),
    name: str(100),
    jan: str(20).optional(),
    expireType: str(20).optional(),
    remainingDays: str(20).optional(),
  })
  .strict();

export type HubProduct = z.infer<typeof HubProduct>;

export const HubProductsBody = z
  .object({ products: z.array(HubProduct).min(1).max(HUB_MAX_ROWS) })
  .strict();

/** 伝票 → CSV と同じ列名の行（1 明細 = 1 行・見出しの値は全行に入る） */
export function toThomasOrderRows(orders: HubOrder[]): ThomasRow[] {
  const rows: ThomasRow[] = [];
  for (const o of orders) {
    for (const it of o.items) {
      rows.push({
        [O.SHIP_DATE]: o.shipDate,
        [O.PK_NO]: o.pkNo,
        [O.CARRIER]: o.carrier,
        [O.PRODUCT_CODE]: it.productCode,
        [O.QTY]: String(it.qty),
        [O.PRODUCT_NAME]: it.productName ?? '',
        [O.DEST_ZIP]: o.destZip ?? '',
        [O.DEST_ADDR]: o.destAddr ?? '',
        [O.DEST_NAME]: o.destName ?? '',
        [O.INVOICE_NO]: o.invoiceNo ?? '',
        [O.QR_PRINT_FLAG]: o.noshiFlag ?? '',
        [O.NOSHI_CODE]: o.noshiCode ?? '',
        [O.CUSTOMER_CODE]: o.customerCode ?? '',
        [O.ORDER_NO]: o.orderNo ?? '',
        [O.NOSHI_NAME]: o.noshiName ?? '',
        [O.NOSHI_PERSON]: o.noshiPerson ?? '',
        [O.DELIVERY_DATE]: o.deliveryDate ?? '',
      });
    }
  }
  return rows;
}

export function toThomasProductRows(products: HubProduct[]): ThomasRow[] {
  return products.map((p) => ({
    [P.CODE]: p.code,
    [P.NAME]: p.name,
    [P.JAN]: p.jan ?? '',
    [P.EXPIRE_TYPE]: p.expireType ?? '',
    [P.REMAINING_DAYS]: p.remainingDays ?? '',
  }));
}

export type SlipResult = {
  pkNo: string;
  result: 'imported' | 'duplicate' | 'dropped_unmapped' | 'error';
  messages: string[];
  missingProductCodes?: string[];
};

/**
 * 伝票ごとの結果（HUB が「どの伝票が入らなかったか」をそのまま表示できるように）。
 * 判定の順：登録済み → 重複 → 未登録商品 → その他のエラー → どこにも無い（不明・黙って消さない）
 */
export function summarizeSlips(
  pkNos: string[],
  result: { importedPkNos?: string[]; errors: ImportRowError[] },
): SlipResult[] {
  const imported = new Set(result.importedPkNos ?? []);
  const byPk = new Map<string, ImportRowError[]>();
  for (const e of result.errors) {
    if (!e.pkNo) continue;
    byPk.set(e.pkNo, [...(byPk.get(e.pkNo) ?? []), e]);
  }
  return pkNos.map((pkNo) => {
    const errs = byPk.get(pkNo) ?? [];
    const messages = errs.map((e) => e.message);
    if (imported.has(pkNo)) return { pkNo, result: 'imported', messages };
    if (errs.some((e) => e.reason === 'duplicate_pk_no')) return { pkNo, result: 'duplicate', messages };
    const missing = errs.filter((e) => e.reason === 'product_not_found').map((e) => e.productCode ?? '');
    if (missing.length > 0) return { pkNo, result: 'dropped_unmapped', messages, missingProductCodes: missing };
    if (errs.length > 0) return { pkNo, result: 'error', messages };
    return { pkNo, result: 'error', messages: ['取込結果が不明です（サーバログを確認してください）'] };
  });
}
