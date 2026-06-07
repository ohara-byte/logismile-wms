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