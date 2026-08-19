/**
 * 出荷指示 明細の重複マージ テスト
 *
 * 実行: npm test
 *
 * ★ 2026-08-19 の現場報告（冨岡様の伝票が取り込まれない）の再発防止。
 *   同一伝票に同じ商品コードが 2 行あると ShippingOrderItem の
 *   @@unique([orderId, productCode]) に抵触し、伝票が丸ごと落ちていた。
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mergeDuplicateItems, type RawOrderItem } from '../integration/merge-items';

const item = (
  productCode: string,
  qty: number,
  productName = '商品',
  sortOrder = 0,
  rowIndex = 1,
): RawOrderItem => ({ productCode, productName, qty, sortOrder, rowIndex });

test('重複が無ければそのまま（並び順も維持）', () => {
  const { items, merged } = mergeDuplicateItems([
    item('7000', 4, '定期ﾊﾟｯｸ', 0, 1),
    item('7042', 1, '大江ノ郷ぷりん４個', 1, 2),
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.productCode), ['7000', '7042']);
  assert.deepEqual(items.map((i) => i.qty), [4, 1]);
  assert.equal(merged.length, 0);
});

test('★ 冨岡様の伝票：同一商品2行が数量合算で1明細になる', () => {
  const { items, merged } = mergeDuplicateItems([
    item('7000', 4, '定期ﾊﾟｯｸ', 0, 1262),
    item('10-36', 1, '◆八頭ばうむ　いち輪【製品数】', 1, 1263),
    item('10-36', 1, '◆八頭ばうむ　いち輪【製品数】', 2, 1264),
  ]);
  assert.equal(items.length, 2);
  const bau = items.find((i) => i.productCode === '10-36');
  assert.equal(bau?.qty, 2, '数量が合算されていない');
  assert.equal(bau?.mergedRows, 2);
  assert.deepEqual(merged, [
    {
      productCode: '10-36',
      productName: '◆八頭ばうむ　いち輪【製品数】',
      rows: 2,
      totalQty: 2,
    },
  ]);
});

test('3行以上でも合算できる', () => {
  const { items } = mergeDuplicateItems([
    item('A', 1),
    item('A', 2),
    item('A', 3),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 6);
  assert.equal(items[0].mergedRows, 3);
});

test('品名と並び順は最初の行を採用する', () => {
  const { items } = mergeDuplicateItems([
    item('B', 1, '正しい品名', 0, 10),
    item('A', 1, 'Aの品名', 1, 11),
    item('B', 1, '後から来た別表記', 2, 12),
  ]);
  // 最初に現れた B が先頭のまま
  assert.deepEqual(items.map((i) => i.productCode), ['B', 'A']);
  assert.equal(items[0].productName, '正しい品名');
});

test('sortOrder は 0 から詰め直される（欠番を作らない）', () => {
  const { items } = mergeDuplicateItems([
    item('A', 1, '商品', 0, 1),
    item('A', 1, '商品', 1, 2),
    item('B', 1, '商品', 2, 3),
    item('C', 1, '商品', 3, 4),
  ]);
  assert.deepEqual(items.map((i) => i.sortOrder), [0, 1, 2]);
});

test('商品コードの前後空白は無視して同一視する', () => {
  const { items } = mergeDuplicateItems([item(' 7000', 1), item('7000 ', 2)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].productCode, '7000');
  assert.equal(items[0].qty, 3);
});

test('大文字小文字の違いは別商品として扱う（勝手に同一視しない）', () => {
  // 商品マスタが区別しうるため、正規化して別商品を統合してしまう事故を避ける
  const { items } = mergeDuplicateItems([item('abc-1', 1), item('ABC-1', 1)]);
  assert.equal(items.length, 2);
});

test('空配列でも壊れない', () => {
  const { items, merged } = mergeDuplicateItems([]);
  assert.deepEqual(items, []);
  assert.deepEqual(merged, []);
});
