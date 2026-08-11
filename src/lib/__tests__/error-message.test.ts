/**
 * エラーメッセージ日本語化のテスト
 *
 * 実行: npm test
 *
 * ★ 目的は「端末に英語・コードだけが出る状態を作らない」ことの固定。
 *   2026-08-11 以前は `HTTP 500` や `TypeError: Failed to fetch` が
 *   そのまま現場の画面に出ており、何が起きたのか判断できなかった。
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  toFriendlyError,
  httpStatusToJapanese,
  hasJapanese,
} from '../error-message';

test('hasJapanese: 日本語の有無を判定', () => {
  assert.equal(hasJapanese('この伝票は既に検品済みです'), true);
  assert.equal(hasJapanese('ピッキングNo'), true); // 漢字・カタカナ混在
  assert.equal(hasJapanese('Failed to fetch'), false);
  assert.equal(hasJapanese('HTTP 500'), false);
});

test('サーバの日本語メッセージはそのまま尊重する', () => {
  const e = toFriendlyError('この伝票は既に検品済みです', { status: 409 });
  assert.equal(e.title, 'この伝票は既に検品済みです');
});

test('通信断は日本語＋対処を返し、原文を残す', () => {
  const e = toFriendlyError(new TypeError('Failed to fetch'));
  assert.equal(e.title, 'サーバーに接続できません');
  assert.match(e.hint ?? '', /Wi-Fi/);
  assert.match(e.raw ?? '', /Failed to fetch/);
});

test('Safari / Firefox の別文言も通信断として扱う', () => {
  assert.equal(toFriendlyError(new Error('Load failed')).title, 'サーバーに接続できません');
  assert.equal(
    toFriendlyError(new Error('NetworkError when attempting to fetch resource.')).title,
    'サーバーに接続できません',
  );
});

test('タイムアウトは専用の日本語', () => {
  const e = toFriendlyError(new Error('AbortError: signal timed out'));
  assert.equal(e.title, '応答がありませんでした（タイムアウト）');
});

test('HTTP ステータスごとに日本語が出る', () => {
  assert.equal(httpStatusToJapanese(401).title, 'ログインの有効期限が切れました');
  assert.equal(httpStatusToJapanese(403).title, 'この操作を行う権限がありません');
  assert.equal(httpStatusToJapanese(404).title, '対象が見つかりません');
  assert.equal(httpStatusToJapanese(409).title, '他の端末と操作が重なりました');
  assert.equal(httpStatusToJapanese(500).title, 'サーバー側でエラーが発生しました');
  assert.equal(httpStatusToJapanese(503).title, 'サーバーに接続できません');
});

test('英語のみのサーバメッセージはステータスの日本語に置き換え、原文を残す', () => {
  const e = toFriendlyError('Internal Server Error', { status: 500 });
  assert.equal(e.title, 'サーバー側でエラーが発生しました');
  assert.match(e.raw ?? '', /Internal Server Error/);
});

test('★ どんな入力でも title は必ず日本語になる（英語だけを出さない）', () => {
  const inputs: unknown[] = [
    null,
    undefined,
    '',
    'HTTP 500',
    'Unexpected token < in JSON at position 0',
    new Error('boom'),
    new TypeError('Failed to fetch'),
    { code: 'P2002' },
    500,
  ];
  for (const i of inputs) {
    const e = toFriendlyError(i, { status: 500 });
    assert.ok(hasJapanese(e.title), `日本語になっていない: ${JSON.stringify(i)} → ${e.title}`);
  }
});

test('ステータス不明・定型外は fallbackTitle を使える', () => {
  const e = toFriendlyError(new Error('boom'), { fallbackTitle: '検品の開始に失敗しました' });
  assert.equal(e.title, '検品の開始に失敗しました');
  assert.match(e.raw ?? '', /boom/);
});

test('★ 既存コードの「日本語 + HTTPコード」を分離する', () => {
  // 理由が書かれていない → ステータスの日本語に置き換え
  const a = toFriendlyError('エラー: HTTP 500');
  assert.equal(a.title, 'サーバー側でエラーが発生しました');
  assert.match(a.raw ?? '', /HTTP 500/);

  // 理由が書かれている → その日本語を見出しに、コードは raw へ
  const b = toFriendlyError('引き継ぎに失敗しました: HTTP 409');
  assert.equal(b.title, '引き継ぎに失敗しました');
  assert.match(b.hint ?? '', /読み込み直/);
  assert.match(b.raw ?? '', /HTTP 409/);

  // コードのみ
  const c = toFriendlyError('HTTP 404');
  assert.equal(c.title, '対象が見つかりません');
});

test('★ 端末に出る文言にHTTPコードや英語が残らない', () => {
  const samples = [
    'エラー: HTTP 500',
    'HTTP 404',
    'HTTP 401',
    '数量入力失敗',
    'セッション開始に失敗',
    'Internal Server Error',
    'TypeError: Failed to fetch',
  ];
  for (const s of samples) {
    const e = toFriendlyError(s, { status: 500 });
    assert.ok(hasJapanese(e.title), `日本語でない: ${s} → ${e.title}`);
    assert.ok(!/HTTP\s*\d{3}/i.test(e.title), `見出しにHTTPコードが残る: ${s} → ${e.title}`);
    assert.ok(!/[A-Za-z]{6,}/.test(e.title), `見出しに英単語が残る: ${s} → ${e.title}`);
  }
});
