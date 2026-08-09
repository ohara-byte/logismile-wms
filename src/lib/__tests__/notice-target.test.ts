/**
 * 連絡事項の宛先判定テスト
 *
 * 実行: npm test
 *
 * ★ このテストは「誤配信しないこと」を固定する目的が主。
 *   2026-08-09 以前は
 *     - 「担当グループ全員」が targetId='group'（文字列リテラル）で送られ誰にも届かない
 *     - 「担当者」が未着手伝票では targetId=null で誰にも届かない
 *     - targetType='table' が default に落ちて全員配信になる
 *   という不具合があった。以下のケースはその再発防止を兼ねる。
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { matchesNoticeTarget, normalizeTableLetter, type RecipientCtx } from '../notice-target';

/** F テーブル担当（グループ G3）のタブレット作業者 */
const tabletF: RecipientCtx = {
  deviceType: 'tablet',
  staffCode: 'S001',
  groupIds: ['G3'],
  tableLetters: ['E', 'F'],
};

/** A テーブル担当（グループ G1）のハンディ作業者 */
const handyA: RecipientCtx = {
  deviceType: 'handy',
  staffCode: 'S002',
  groupIds: ['G1'],
  tableLetters: ['A', 'B'],
};

test('all: 端末・担当を問わず全員に配信', () => {
  assert.equal(matchesNoticeTarget({ targetType: 'all', targetId: null }, tabletF), true);
  assert.equal(matchesNoticeTarget({ targetType: 'all', targetId: null }, handyA), true);
});

test('tablet / handy: 端末種別で振り分ける', () => {
  const toTablet = { targetType: 'tablet', targetId: null };
  const toHandy = { targetType: 'handy', targetId: null };
  assert.equal(matchesNoticeTarget(toTablet, tabletF), true);
  assert.equal(matchesNoticeTarget(toTablet, handyA), false);
  assert.equal(matchesNoticeTarget(toHandy, handyA), true);
  assert.equal(matchesNoticeTarget(toHandy, tabletF), false);
});

test('tablet: 端末種別が不明なら配信しない', () => {
  const unknownDevice: RecipientCtx = { ...tabletF, deviceType: null };
  assert.equal(
    matchesNoticeTarget({ targetType: 'tablet', targetId: null }, unknownDevice),
    false,
  );
});

test('table: 担当テーブルが一致したときだけ配信', () => {
  assert.equal(matchesNoticeTarget({ targetType: 'table', targetId: 'F' }, tabletF), true);
  // 別テーブル宛は届かない（誤配信防止の要）
  assert.equal(matchesNoticeTarget({ targetType: 'table', targetId: 'A' }, tabletF), false);
  assert.equal(matchesNoticeTarget({ targetType: 'table', targetId: 'F' }, handyA), false);
});

test('table: 小文字・空白混じりの targetId も一致させる', () => {
  assert.equal(matchesNoticeTarget({ targetType: 'table', targetId: ' f ' }, tabletF), true);
});

test('table: targetId が無ければ配信しない（全員配信にしない）', () => {
  assert.equal(matchesNoticeTarget({ targetType: 'table', targetId: null }, tabletF), false);
  assert.equal(matchesNoticeTarget({ targetType: 'table', targetId: '' }, tabletF), false);
});

test('group: 当日割当で複数グループに入っていても判定できる', () => {
  const multi: RecipientCtx = { ...tabletF, groupIds: ['G3', 'G5'] };
  assert.equal(matchesNoticeTarget({ targetType: 'group', targetId: 'G5' }, multi), true);
  assert.equal(matchesNoticeTarget({ targetType: 'group', targetId: 'G3' }, multi), true);
  assert.equal(matchesNoticeTarget({ targetType: 'group', targetId: 'G9' }, multi), false);
});

test('group: 旧実装のバグ再発防止 — targetId に文字列 "group" が来ても配信しない', () => {
  assert.equal(matchesNoticeTarget({ targetType: 'group', targetId: 'group' }, tabletF), false);
});

test('staff: 本人にだけ配信', () => {
  assert.equal(matchesNoticeTarget({ targetType: 'staff', targetId: 'S001' }, tabletF), true);
  assert.equal(matchesNoticeTarget({ targetType: 'staff', targetId: 'S002' }, tabletF), false);
});

test('staff: targetId が null なら誰にも配信しない', () => {
  // 未着手伝票で担当者未確定のまま送られたケース
  assert.equal(matchesNoticeTarget({ targetType: 'staff', targetId: null }, tabletF), false);
  const anonymous: RecipientCtx = { ...tabletF, staffCode: null };
  assert.equal(matchesNoticeTarget({ targetType: 'staff', targetId: null }, anonymous), false);
});

test('未知の targetType は取りこぼし防止で配信する', () => {
  assert.equal(matchesNoticeTarget({ targetType: 'legacy', targetId: null }, tabletF), true);
});

test('normalizeTableLetter: 大文字化・空白除去・空文字は null', () => {
  assert.equal(normalizeTableLetter(' f '), 'F');
  assert.equal(normalizeTableLetter('F'), 'F');
  assert.equal(normalizeTableLetter(''), null);
  assert.equal(normalizeTableLetter('   '), null);
  assert.equal(normalizeTableLetter(null), null);
  assert.equal(normalizeTableLetter(undefined), null);
});
