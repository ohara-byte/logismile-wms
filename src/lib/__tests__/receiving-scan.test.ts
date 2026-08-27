/**
 * 受入検品のスキャン解決 テスト
 *
 * 実行: npm test
 *
 * ★ CraftSmile のラベルQR（CS1|…）を読んで、商品特定と数量の自動入力ができること。
 *   書式は CraftSmile 側 buildLabelQr と一致していなければならない
 *   （連携契約は factory-contract.test.ts で固定）。
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  parseFactoryLabelQr,
  labelKey,
  resolveScan,
  resolveQtyPrefillFromLabel,
  FACTORY_LABEL_QR_VERSION,
} from '../receiving-scan';

const items = [
  { productCode: '5203-1', jan: '2800022130529' },
  { productCode: '5194-2', jan: null },
  { productCode: 'ABC-1', jan: null },
];

test('★ CraftSmile のラベルQR を分解できる', () => {
  const l = parseFactoryLabelQr('CS1|20260828|5203-1|24|001');
  assert.deepEqual(l, {
    shipDate: '2026-08-28',
    productCode: '5203-1',
    qty: 24,
    serial: 1,
  });
});

test('前後の空白は無視する（読取機が改行や空白を付けることがある）', () => {
  assert.ok(parseFactoryLabelQr('  CS1|20260828|5203-1|24|001  '));
});

test('CraftSmile のラベルでなければ null（従来のバーコード扱いへ回す）', () => {
  for (const raw of [
    '2800022130529', // JAN
    '5203-1', // 商品コード
    '', // 空
    'CS2|20260828|5203-1|24|001', // 別の版
    'CS1', // 区切りなし
    'CS1|20260828|5203-1|24', // 項目が足りない
    'CS1|20260828|5203-1|24|001|extra', // 項目が多い
    'CS1|2026-08-28|5203-1|24|001', // 発送日がハイフン付き
    'CS1|20260828||24|001', // 商品コードが空
    'CS1|20260828|5203-1|abc|001', // 数量が数字でない
    'CS1|20260828|5203-1|-1|001', // 数量が負
    'CS1|20260828|5203-1|24|000', // 連番が0
  ]) {
    assert.equal(parseFactoryLabelQr(raw), null, `null になるべき: ${raw}`);
  }
});

test('数量0のラベルは有効（送信が0で通ることは無いが、書式としては許す）', () => {
  assert.equal(parseFactoryLabelQr('CS1|20260828|5203-1|0|001')?.qty, 0);
});

test('版の接頭辞は定数と一致している', () => {
  assert.equal(FACTORY_LABEL_QR_VERSION, 'CS1');
});

test('★ ラベルキーは発送日・商品・連番で決まる（数量は含めない）', () => {
  const a = parseFactoryLabelQr('CS1|20260828|5203-1|24|001')!;
  const b = parseFactoryLabelQr('CS1|20260828|5203-1|30|001')!; // 数量だけ違う
  const c = parseFactoryLabelQr('CS1|20260828|5203-1|24|002')!; // 連番が違う
  assert.equal(labelKey(a), labelKey(b), '数量違いは同じラベルとみなす');
  assert.notEqual(labelKey(a), labelKey(c), '連番違いは別ラベル');
});

test('★ ラベルを読むと商品が特定でき、数量も取れる', () => {
  const r = resolveScan('CS1|20260828|5194-2|12|001', items);
  assert.equal(r.kind, 'label');
  if (r.kind !== 'label') return;
  assert.equal(r.item.productCode, '5194-2');
  assert.equal(r.label.qty, 12);
});

test('ラベルだがこの納品に無い商品なら label_not_in_list', () => {
  const r = resolveScan('CS1|20260828|9999-9|5|001', items);
  assert.equal(r.kind, 'label_not_in_list');
  if (r.kind !== 'label_not_in_list') return;
  assert.equal(r.label.productCode, '9999-9');
});

test('従来の JAN スキャンは今までどおり通る', () => {
  const r = resolveScan('2800022130529', items);
  assert.equal(r.kind, 'plain');
  if (r.kind !== 'plain') return;
  assert.equal(r.item.productCode, '5203-1');
});

test('従来の商品コードスキャンも通る（大小・空白は無視）', () => {
  for (const raw of ['ABC-1', 'abc-1', '  abc-1  ']) {
    const r = resolveScan(raw, items);
    assert.equal(r.kind, 'plain', raw);
  }
});

test('JAN は完全一致（大小を無視しない＝数字なので影響しないが挙動を固定）', () => {
  assert.equal(resolveScan('2800022130529', items).kind, 'plain');
  assert.equal(resolveScan('28000221305299', items).kind, 'unknown');
});

test('該当なしは unknown', () => {
  assert.equal(resolveScan('9999999999999', items).kind, 'unknown');
  assert.equal(resolveScan('', items).kind, 'unknown');
  assert.equal(resolveScan(null, items).kind, 'unknown');
});

test('ラベル商品コードの照合は大小・空白を無視する', () => {
  const r = resolveScan('CS1|20260828|abc-1|3|001', items);
  assert.equal(r.kind, 'label');
});

test('★ ラベルの数量が検品数の初期値になる（現場の入力がゼロになる）', () => {
  const label = parseFactoryLabelQr('CS1|20260828|5203-1|24|001')!;
  assert.equal(resolveQtyPrefillFromLabel({ current: '', label }), '24');
  assert.equal(resolveQtyPrefillFromLabel({ current: null, label }), '24');
});

test('編集中の入力はラベルでも上書きしない', () => {
  const label = parseFactoryLabelQr('CS1|20260828|5203-1|24|001')!;
  assert.equal(resolveQtyPrefillFromLabel({ current: '7', label }), '7');
});
