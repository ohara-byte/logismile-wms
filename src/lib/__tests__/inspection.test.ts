/**
 * judgeScan 動作確認（JAN プール方式 / node:test ベース）
 * 実行: npm run test:lib
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeScan, isAllInspected, type OrderItem } from '../inspection';

const mk = (
  id: number,
  productCode: string,
  jan: string | null,
  qty: number,
  scannedQty: number,
): OrderItem => ({ id, productCode, product: { jan }, qty, scannedQty });

test('judgeScan: 空入力は not_found', () => {
  assert.equal(judgeScan([mk(1, 'P-1', '49001', 1, 0)], '  ', 1).result, 'not_found');
});

test('judgeScan: 商品コード完全一致はその明細を対象', () => {
  const items = [mk(1, 'P-1', '49001', 2, 0), mk(2, 'P-2', '49001', 3, 0)];
  const r = judgeScan(items, 'P-2', 1);
  assert.equal(r.result, 'matched');
  assert.equal(r.itemId, 2);
  assert.equal(r.nextScannedQty, 1);
});

test('judgeScan: JAN 単一一致は通常加算', () => {
  const items = [mk(1, 'P-1', '49001', 2, 0)];
  const r = judgeScan(items, '49001', 1);
  assert.equal(r.result, 'matched');
  assert.equal(r.itemId, 1);
  assert.equal(r.nextScannedQty, 1);
});

test('judgeScan: 該当なしは not_found', () => {
  const items = [mk(1, 'P-1', '49001', 2, 0)];
  assert.equal(judgeScan(items, '99999', 1).result, 'not_found');
});

test('★ JANプール: 同一JANの明細へ先頭から順に流し込む', () => {
  // A(必要2) と B(必要3) が同一JAN 49001。合計5回のJANスキャンで全完了する想定。
  let items = [mk(1, 'P-1', '49001', 2, 0), mk(2, 'P-2', '49001', 3, 0)];

  // 1回目・2回目 → A が埋まる
  let r = judgeScan(items, '49001', 1);
  assert.equal(r.result, 'matched');
  assert.equal(r.itemId, 1);
  assert.equal(r.nextScannedQty, 1);
  items = items.map((i) => (i.id === 1 ? { ...i, scannedQty: 1 } : i));

  r = judgeScan(items, '49001', 1);
  assert.equal(r.itemId, 1);
  assert.equal(r.nextScannedQty, 2);
  items = items.map((i) => (i.id === 1 ? { ...i, scannedQty: 2 } : i));

  // 3回目 → A は満杯なので B に流れる（ここが旧実装では already_done だった）
  r = judgeScan(items, '49001', 1);
  assert.equal(r.result, 'matched');
  assert.equal(r.itemId, 2, '3回目は B(id=2) に加算されるべき');
  assert.equal(r.nextScannedQty, 1);
  items = items.map((i) => (i.id === 2 ? { ...i, scannedQty: 1 } : i));

  // 4・5回目 → B が埋まる
  r = judgeScan(items, '49001', 1);
  assert.equal(r.itemId, 2);
  items = items.map((i) => (i.id === 2 ? { ...i, scannedQty: 2 } : i));
  r = judgeScan(items, '49001', 1);
  assert.equal(r.itemId, 2);
  assert.equal(r.nextScannedQty, 3);
  items = items.map((i) => (i.id === 2 ? { ...i, scannedQty: 3 } : i));

  // 全完了 → これ以上の JAN スキャンは already_done
  assert.equal(judgeScan(items, '49001', 1).result, 'already_done');
  assert.ok(isAllInspected(items.map((i) => ({ ...i, forceOk: false }))));
});

test('JANプール: 片方が既に満杯なら残数のある明細へ', () => {
  // A は満杯、B に残数 → B に加算
  const items = [mk(1, 'P-1', '49001', 2, 2), mk(2, 'P-2', '49001', 3, 1)];
  const r = judgeScan(items, '49001', 1);
  assert.equal(r.result, 'matched');
  assert.equal(r.itemId, 2);
  assert.equal(r.nextScannedQty, 2);
});

// ── ラッピング代替バーコード（2026-06-23）──
const mkw = (
  id: number,
  productCode: string,
  jan: string | null,
  qty: number,
  scannedQty: number,
  productName: string,
): OrderItem => ({ id, productCode, product: { jan }, productName, qty, scannedQty });

const CORE = '01208680006'; // pkNo 'SA01208680006' の先頭英字を除いたコア

test('ラッピング: 数字コア一致 → ラッピング明細をJAN昇順で割当', () => {
  const items = [
    mkw(1, 'P-1', '49002', 1, 0, 'ラッピング 黒毛和牛'),
    mkw(2, 'P-2', '49001', 1, 0, 'ラッピング 天美卵'),
    mkw(3, 'P-3', '49003', 1, 0, '通常商品'),
  ];
  const r = judgeScan(items, CORE, 1, { orderCore: CORE });
  assert.equal(r.result, 'matched');
  assert.equal(r.itemId, 2, 'JAN昇順=49001(id2)が先頭');
  assert.equal(r.nextScannedQty, 1);
});

test('ラッピング: 2個目はJAN昇順で次の未完了明細', () => {
  const items = [
    mkw(1, 'P-1', '49002', 1, 0, 'ラッピングA'),
    mkw(2, 'P-2', '49001', 1, 1, 'ラッピングB'), // 49001は完了済
  ];
  const r = judgeScan(items, CORE, 1, { orderCore: CORE });
  assert.equal(r.itemId, 1, '49001完了→次は49002(id1)');
});

test('ラッピング: 明細が無ければ wrap_none', () => {
  const items = [mkw(1, 'P-1', '49001', 1, 0, '通常商品')];
  assert.equal(judgeScan(items, CORE, 1, { orderCore: CORE }).result, 'wrap_none');
});

test('ラッピング: 全完了後は already_done', () => {
  const items = [mkw(1, 'P-1', '49001', 1, 1, 'ラッピングA')];
  assert.equal(judgeScan(items, CORE, 1, { orderCore: CORE }).result, 'already_done');
});

test('ラッピング: 英字始まり(全pkNo)は発火せず通常照合(=not_found)', () => {
  const items = [mkw(1, 'P-1', '49001', 1, 0, 'ラッピングA')];
  const r = judgeScan(items, 'SA01208680006', 1, { orderCore: CORE });
  assert.equal(r.result, 'not_found');
});

test('ラッピング: コア不一致の数字は通常JAN照合に流れる', () => {
  const items = [mkw(1, 'P-1', '49001', 1, 0, 'ラッピングA')];
  const r = judgeScan(items, '49001', 1, { orderCore: CORE });
  assert.equal(r.result, 'matched');
  assert.equal(r.itemId, 1);
});

test('ラッピング: 半角カナの商品名でも前方一致(NFKC正規化)', () => {
  const items = [mkw(1, 'P-1', '49001', 1, 0, 'ﾗｯﾋﾟﾝｸﾞ半角')];
  assert.equal(judgeScan(items, CORE, 1, { orderCore: CORE }).result, 'matched');
});

test('ラッピング: orderCore 未指定なら従来動作（数字はJAN照合のみ）', () => {
  const items = [mkw(1, 'P-1', '49001', 1, 0, 'ラッピングA')];
  // orderCore を渡さない＝既存呼び出し互換。CORE はJANでないので not_found。
  assert.equal(judgeScan(items, CORE, 1).result, 'not_found');
});