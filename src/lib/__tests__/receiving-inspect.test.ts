/**
 * ハンディ 受入検品の入力ロジック テスト
 *
 * 実行: npm test
 *
 * ★ 目的は「加算にしたことで二重計上を生まないこと」の固定。
 *   2026-08-26 以前は既に検品済みの商品をスキャンすると検品数欄に
 *   納品数が初期表示され、そのまま押すと上書きされていた。
 *   加算に変えた以上、同じ初期表示を残すと今度は二重計上になる。
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  resolveQtyPrefill,
  validateInspectInput,
} from '../receiving-inspect';

test('未検品なら納品数を初期表示（全数検品が通常）', () => {
  assert.equal(
    resolveQtyPrefill({ current: '', inspectedQty: 0, deliveredQty: 12 }),
    '12',
  );
  assert.equal(
    resolveQtyPrefill({ current: null, inspectedQty: 0, deliveredQty: 0 }),
    '0',
  );
});

test('★ 検品済みなら空にする（納品数を入れると加算で二重計上になる）', () => {
  assert.equal(
    resolveQtyPrefill({ current: '', inspectedQty: 5, deliveredQty: 12 }),
    '',
  );
  assert.equal(
    resolveQtyPrefill({ current: undefined, inspectedQty: 12, deliveredQty: 12 }),
    '',
  );
});

test('編集中の入力は上書きしない', () => {
  assert.equal(
    resolveQtyPrefill({ current: '3', inspectedQty: 0, deliveredQty: 12 }),
    '3',
  );
  assert.equal(
    resolveQtyPrefill({ current: '7', inspectedQty: 5, deliveredQty: 12 }),
    '7',
  );
  // 0 も「入力済み」として尊重する（空文字だけを未入力とみなす）
  assert.equal(
    resolveQtyPrefill({ current: '0', inspectedQty: 0, deliveredQty: 12 }),
    '0',
  );
});

test('空欄・非整数・負数はどちらのモードでも不可', () => {
  for (const mode of ['add', 'set'] as const) {
    assert.equal(validateInspectInput({ raw: '', mode }).ok, false);
    assert.equal(validateInspectInput({ raw: '  ', mode }).ok, false);
    assert.equal(validateInspectInput({ raw: null, mode }).ok, false);
    assert.equal(validateInspectInput({ raw: '1.5', mode }).ok, false);
    assert.equal(validateInspectInput({ raw: '-1', mode }).ok, false);
    assert.equal(validateInspectInput({ raw: 'あ', mode }).ok, false);
  }
});

test('★ 追加で 0 は不可（何も足さない＝入力ミス）', () => {
  const r = validateInspectInput({ raw: '0', mode: 'add' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /1 以上/);
});

test('★ 訂正で 0 は可（検品数を 0 に戻す正当な操作）', () => {
  const r = validateInspectInput({ raw: '0', mode: 'set' });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.qty, 0);
});

test('正常な数量は数値で返る', () => {
  const a = validateInspectInput({ raw: '4', mode: 'add' });
  assert.equal(a.ok, true);
  if (a.ok) assert.equal(a.qty, 4);
  const b = validateInspectInput({ raw: ' 10 ', mode: 'set' });
  assert.equal(b.ok, true);
  if (b.ok) assert.equal(b.qty, 10);
});
