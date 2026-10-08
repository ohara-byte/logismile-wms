/**
 * OENO EC Hub（HUB）→ LogiSmile 連携の契約テスト（2026-10-08・ohara 様「HUB 起点で連携」）。
 *
 * ★ 署名の基準値は HUB（oeno-echub: tests/Unit/Integration/HubContractVectorTest.php）と
 *   Craftsmile（craftsmile-mfg: tests/unit/hub-contract.test.ts）の契約テストと**同じ値**。
 *   3 システムで同じ方式を使う。片側だけ変えると本番で 401 になる。
 *
 *   canonical = `${timestamp}\n${rawBody}` / HMAC-SHA256 / hex
 *   ヘッダ = X-Hub-Signature / X-Hub-Timestamp / Idempotency-Key
 */

import { test, expect, describe, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  HUB_HEADERS,
  HUB_SECRET_MIN_LENGTH,
  HUB_TIMESTAMP_TOLERANCE_SEC,
  getHubInboundSecret,
  hubSignature,
  isHubIntegrationEnabled,
  verifyHubRequest,
} from '../integration/hub-auth';
import {
  HubOrdersBody,
  HubProductsBody,
  summarizeSlips,
  toThomasOrderRows,
  toThomasProductRows,
} from '../integration/hub-payload';
import { ORDER_CSV_COLUMNS, PRODUCT_CSV_COLUMNS } from '../integration/mapping';

const VECTOR = {
  secret: 'hub-contract-secret-0123456789abcdef0123',
  timestamp: 1760000000,
  body:
    '{"basis":"ship","from":"2026-10-07","to":"2026-10-08","generatedAt":"2026-10-07T09:45:00+09:00",' +
    '"items":[{"code":"2811-1","name":"郷のとりごぼうご飯の素【数量】","date":"2026-10-08","qty":12}]}',
  signature: '397d469574455915a66962d3c31752c888782c1f361de24c8dcc4584424786ca',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('署名（HUB・Craftsmile と共有の基準値）', () => {
  test('★ 基準値の署名が一致する', () => {
    expect(hubSignature(VECTOR.secret, VECTOR.timestamp, VECTOR.body)).toBe(VECTOR.signature);
    const independent = crypto.createHmac('sha256', VECTOR.secret).update(`${VECTOR.timestamp}\n${VECTOR.body}`).digest('hex');
    expect(VECTOR.signature).toBe(independent);
  });

  test('ヘッダ名・鍵長・時刻の許容幅を固定する', () => {
    expect(HUB_HEADERS).toEqual({ signature: 'x-hub-signature', timestamp: 'x-hub-timestamp', idempotencyKey: 'idempotency-key' });
    expect(HUB_SECRET_MIN_LENGTH).toBe(32);
    expect(HUB_TIMESTAMP_TOLERANCE_SEC).toBe(300);
  });
});

describe('verifyHubRequest', () => {
  const base = {
    secret: VECTOR.secret,
    signature: VECTOR.signature,
    timestamp: String(VECTOR.timestamp),
    idempotencyKey: 'hub-wms-orders-20261008090000',
    rawBody: VECTOR.body,
    nowSec: VECTOR.timestamp,
  };

  test('正しければ ok', () => {
    expect(verifyHubRequest(base)).toEqual({ ok: true, idempotencyKey: base.idempotencyKey });
  });
  test('★ 鍵が未設定・32 文字未満は 503（空鍵で誰でも署名できる状態にしない）', () => {
    for (const secret of [null, '', 'x'.repeat(31)]) {
      expect(verifyHubRequest({ ...base, secret })).toMatchObject({ ok: false, status: 503 });
    }
  });
  test('署名・時刻が無い・時刻が整数でない・±300 秒を超える・本文が違えば 401', () => {
    expect(verifyHubRequest({ ...base, signature: null })).toMatchObject({ status: 401 });
    expect(verifyHubRequest({ ...base, timestamp: null })).toMatchObject({ status: 401 });
    expect(verifyHubRequest({ ...base, timestamp: '1.5' })).toMatchObject({ status: 401 });
    expect(verifyHubRequest({ ...base, nowSec: VECTOR.timestamp + 300 }).ok).toBe(true);
    expect(verifyHubRequest({ ...base, nowSec: VECTOR.timestamp + 301 })).toMatchObject({ status: 401 });
    expect(verifyHubRequest({ ...base, rawBody: VECTOR.body + ' ' })).toMatchObject({ status: 401 });
    expect(verifyHubRequest({ ...base, signature: 'zz' })).toMatchObject({ status: 401 });
  });
  test('署名が正しくても Idempotency-Key が無い・不正なら 400（署名不正は先に 401）', () => {
    expect(verifyHubRequest({ ...base, idempotencyKey: null })).toMatchObject({ status: 400 });
    expect(verifyHubRequest({ ...base, idempotencyKey: 'a b' })).toMatchObject({ status: 400 });
    expect(verifyHubRequest({ ...base, signature: 'f'.repeat(64), idempotencyKey: null })).toMatchObject({ status: 401 });
  });
});

describe('有効化と鍵（環境変数）', () => {
  test('HUB_INTEGRATION_ENABLED=true のときだけ有効（既定は無効）', () => {
    expect(isHubIntegrationEnabled()).toBe(false);
    vi.stubEnv('HUB_INTEGRATION_ENABLED', 'true');
    expect(isHubIntegrationEnabled()).toBe(true);
  });
  test('鍵は HUB_TO_WMS_SECRET。32 文字未満は未設定扱い', () => {
    vi.stubEnv('HUB_TO_WMS_SECRET', 'x'.repeat(31));
    expect(getHubInboundSecret()).toBeNull();
    vi.stubEnv('HUB_TO_WMS_SECRET', ` ${'x'.repeat(32)} `);
    expect(getHubInboundSecret()).toBe('x'.repeat(32));
  });
});

// ───────────────────────────────────────────────────────────
// 出荷指示（POST /api/integration/hub/orders）
// ───────────────────────────────────────────────────────────

const order = {
  pkNo: 'SB01245370001',
  shipDate: '2026-09-25',
  carrier: 'ヤマト運輸',
  invoiceNo: '61391970001',
  customerCode: '823986',
  orderNo: '6139197',
  destZip: '680-0411',
  destAddr: '鳥取県八頭郡八頭町',
  destName: '山田　太郎',
  noshiFlag: '',
  noshiCode: '',
  noshiName: '',
  noshiPerson: '',
  deliveryDate: '2026-09-26',
  items: [
    { productCode: '70001', productName: '定期Ｍﾊﾟｯｸ', qty: 2 },
    { productCode: '70005', productName: '定期ＬＬﾊﾟｯｸ', qty: 1 },
  ],
};

describe('HubOrdersBody', () => {
  test('Thomas 出荷指示の 17 列を、伝票（見出し＋明細）の形で受ける', () => {
    expect(HubOrdersBody.safeParse({ orders: [order] }).success).toBe(true);
  });
  test('任意項目は省略できる（必須は pkNo / shipDate / carrier / items）', () => {
    const r = HubOrdersBody.safeParse({ orders: [{ pkNo: 'P1', shipDate: '2026/09/25', carrier: 'ヤマト運輸', items: [{ productCode: '1', qty: 1 }] }] });
    expect(r.success).toBe(true);
  });
  test('★ 契約に無い項目は受け付けない（項目を増やすときは両側の契約を同時に直す）', () => {
    expect(HubOrdersBody.safeParse({ orders: [{ ...order, shiwakeCode: 'x' }] }).success).toBe(false);
    expect(HubOrdersBody.safeParse({ orders: [order], extra: 1 }).success).toBe(false);
  });
  test('★ 同じピッキング№の伝票が 2 つあればエラー（どちらの見出しが正か決められない）', () => {
    const r = HubOrdersBody.safeParse({ orders: [order, { ...order }] });
    expect(r.success).toBe(false);
  });
  test('明細は 1 行以上・数量は 0 以上の整数・伝票は 1 件以上', () => {
    expect(HubOrdersBody.safeParse({ orders: [{ ...order, items: [] }] }).success).toBe(false);
    expect(HubOrdersBody.safeParse({ orders: [{ ...order, items: [{ productCode: '1', qty: 1.5 }] }] }).success).toBe(false);
    expect(HubOrdersBody.safeParse({ orders: [{ ...order, items: [{ productCode: '1', qty: -1 }] }] }).success).toBe(false);
    expect(HubOrdersBody.safeParse({ orders: [] }).success).toBe(false);
  });
  test('長さの上限は保存先の列に合わせる（pkNo 30・納品書No 30・送付先名 100・熨斗 50）', () => {
    expect(HubOrdersBody.safeParse({ orders: [{ ...order, pkNo: 'x'.repeat(31) }] }).success).toBe(false);
    expect(HubOrdersBody.safeParse({ orders: [{ ...order, destName: 'x'.repeat(101) }] }).success).toBe(false);
    expect(HubOrdersBody.safeParse({ orders: [{ ...order, noshiName: 'x'.repeat(51) }] }).success).toBe(false);
  });
});

describe('toThomasOrderRows', () => {
  test('★ 1 明細 = 1 行の、CSV と同じ列名の行に直す（見出しの値は全行に入る）', () => {
    const rows = toThomasOrderRows([order]);
    const O = ORDER_CSV_COLUMNS;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      [O.SHIP_DATE]: '2026-09-25',
      [O.PK_NO]: 'SB01245370001',
      [O.CARRIER]: 'ヤマト運輸',
      [O.PRODUCT_CODE]: '70001',
      [O.QTY]: '2',
      [O.PRODUCT_NAME]: '定期Ｍﾊﾟｯｸ',
      [O.DEST_ZIP]: '680-0411',
      [O.DEST_ADDR]: '鳥取県八頭郡八頭町',
      [O.DEST_NAME]: '山田　太郎',
      [O.INVOICE_NO]: '61391970001',
      [O.QR_PRINT_FLAG]: '',
      [O.NOSHI_CODE]: '',
      [O.CUSTOMER_CODE]: '823986',
      [O.ORDER_NO]: '6139197',
      [O.NOSHI_NAME]: '',
      [O.NOSHI_PERSON]: '',
      [O.DELIVERY_DATE]: '2026-09-26',
    });
    expect(rows[1][O.PRODUCT_CODE]).toBe('70005');
    expect(rows[1][O.PK_NO]).toBe('SB01245370001');
  });
  test('省略された項目は空文字（CSV の空欄と同じ）', () => {
    const rows = toThomasOrderRows([{ pkNo: 'P1', shipDate: '2026-09-25', carrier: 'x', items: [{ productCode: '1', qty: 1 }] }]);
    expect(rows[0][ORDER_CSV_COLUMNS.INVOICE_NO]).toBe('');
    expect(rows[0][ORDER_CSV_COLUMNS.PRODUCT_NAME]).toBe('');
  });
});

describe('商品（POST /api/integration/hub/products）', () => {
  test('Thomas 商品の 5 列を受け、CSV と同じ列名の行に直す', () => {
    const body = { products: [{ code: '70001', name: '定期Ｍﾊﾟｯｸ', jan: '2800001000010', expireType: '', remainingDays: '' }] };
    const p = HubProductsBody.safeParse(body);
    expect(p.success).toBe(true);
    const P = PRODUCT_CSV_COLUMNS;
    expect(toThomasProductRows(body.products)).toEqual([
      { [P.CODE]: '70001', [P.NAME]: '定期Ｍﾊﾟｯｸ', [P.JAN]: '2800001000010', [P.EXPIRE_TYPE]: '', [P.REMAINING_DAYS]: '' },
    ]);
  });
  test('契約に無い項目・空配列は受け付けない', () => {
    expect(HubProductsBody.safeParse({ products: [] }).success).toBe(false);
    expect(HubProductsBody.safeParse({ products: [{ code: '1', name: 'a', price: 1 }] }).success).toBe(false);
  });
});

describe('summarizeSlips（伝票ごとの結果を返す）', () => {
  test('★ 登録・重複・未登録商品でスキップ・その他エラーを伝票ごとに返す（WMS要望「取込エラーの対象伝票がわかるように」）', () => {
    const r = summarizeSlips(['P1', 'P2', 'P3', 'P4'], {
      importedPkNos: ['P1'],
      errors: [
        { rowIndex: 2, pkNo: 'P2', reason: 'duplicate_pk_no', message: 'ピッキング№が重複しています（既存伝票あり）: P2' },
        { rowIndex: 3, pkNo: 'P3', productCode: '99', reason: 'product_not_found', message: '商品コードがマスタに未登録: 99' },
        { rowIndex: 4, pkNo: 'P4', reason: 'validation_error', message: '出荷予定日が不正: x' },
      ],
    });
    expect(r).toEqual([
      { pkNo: 'P1', result: 'imported', messages: [] },
      { pkNo: 'P2', result: 'duplicate', messages: ['ピッキング№が重複しています（既存伝票あり）: P2'] },
      { pkNo: 'P3', result: 'dropped_unmapped', messages: ['商品コードがマスタに未登録: 99'], missingProductCodes: ['99'] },
      { pkNo: 'P4', result: 'error', messages: ['出荷予定日が不正: x'] },
    ]);
  });
  test('登録できたのに明細エラーが無い伝票は imported・どこにも出てこない伝票は error（黙って消さない）', () => {
    expect(summarizeSlips(['P9'], { importedPkNos: [], errors: [] })).toEqual([
      { pkNo: 'P9', result: 'error', messages: ['取込結果が不明です（サーバログを確認してください）'] },
    ]);
  });
});
