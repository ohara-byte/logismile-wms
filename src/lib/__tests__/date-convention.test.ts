/**
 * 日付規約テスト（@db.Date の単日範囲）＋ 出荷照合ファミリの回帰防止
 *
 * 実行: npm test
 *
 * `shipDate` は Prisma の `@db.Date`（時刻を持たない DATE 型）で、
 * JS 側では **UTC 真夜中** の Date として読み書きされる。
 * したがって検索範囲も **UTC 真夜中** で作らなければならない。
 *
 * `new Date("2026-07-30")` は UTC 真夜中になるが、そこから
 * `setHours(0,0,0,0)` を呼ぶと **ローカル（JST）真夜中 = 前日 15:00 UTC** に
 * 移動し、`@db.Date` と比較すると 1 日ズレる。
 *
 * 実際に発生した不具合（2026-07-30 報告）：
 *   出荷照合タブで未検品 2 件を選択し一括強制完了 → 「0 件を一括強制完了しました」。
 *   一覧 API `/api/orders/match` と `carryover` は date-utils（UTC 真夜中）を使う一方、
 *   `bulk-action` だけが setHours を使い、同じ date から別の範囲を導出していた。
 *   2026-07-02 の「日付根治」で match / carryover は修正されたが bulk-action が漏れていた。
 */

import { test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseDateAsUTC, addDaysUTC, formatDateYmd } from '../date-utils';

// ───────────────────────────────────────────────
// 1. 日付ヘルパの意味を固定する（TZ に依存しない不変条件）
// ───────────────────────────────────────────────

test('parseDateAsUTC は UTC 真夜中を返す（@db.Date と等値比較できる）', () => {
  const d = parseDateAsUTC('2026-07-30');
  expect(d?.toISOString()).toBe('2026-07-30T00:00:00.000Z');
  // TZ が何であっても UTC 時刻成分は必ず 0
  expect(d?.getUTCHours()).toBe(0);
  expect(d?.getUTCMinutes()).toBe(0);
});

test('addDaysUTC は UTC 暦日で加算する（月末・年末を越えても壊れない）', () => {
  expect(addDaysUTC(parseDateAsUTC('2026-07-30')!, 1).toISOString()).toBe(
    '2026-07-31T00:00:00.000Z',
  );
  expect(addDaysUTC(parseDateAsUTC('2026-07-31')!, 1).toISOString()).toBe(
    '2026-08-01T00:00:00.000Z',
  );
  expect(addDaysUTC(parseDateAsUTC('2026-12-31')!, 1).toISOString()).toBe(
    '2027-01-01T00:00:00.000Z',
  );
  // うるう年（2028-02-29）
  expect(addDaysUTC(parseDateAsUTC('2028-02-28')!, 1).toISOString()).toBe(
    '2028-02-29T00:00:00.000Z',
  );
});

test('parseDateAsUTC は不正な日付を null にする', () => {
  expect(parseDateAsUTC('2026-02-30')).toBeNull();
  expect(parseDateAsUTC('2026-13-01')).toBeNull();
  expect(parseDateAsUTC('26-07-30')).toBeNull();
  expect(parseDateAsUTC('')).toBeNull();
  expect(parseDateAsUTC(null)).toBeNull();
});

test('formatDateYmd は parseDateAsUTC と往復する', () => {
  expect(formatDateYmd(parseDateAsUTC('2026-07-30')!)).toBe('2026-07-30');
});

// ───────────────────────────────────────────────
// 2. 不具合の再現（なぜ setHours が禁止なのか）
// ───────────────────────────────────────────────

test('回帰: 非 UTC 環境では setHours(0,0,0,0) が UTC 真夜中から 1 日ズレる', () => {
  const offsetMin = new Date('2026-07-30T00:00:00Z').getTimezoneOffset();
  // vitest.config.ts で TZ 既定を Asia/Tokyo にしている。UTC で走らせた場合は
  // そもそもズレが起きないため、この検証は成立しない（前提を明示して skip 相当にする）。
  if (offsetMin === 0) {
    expect(offsetMin).toBe(0); // TZ=UTC で実行中：ズレ再現は不可
    return;
  }

  // 旧 bulk-action の実装
  const buggy = new Date('2026-07-30');
  buggy.setHours(0, 0, 0, 0);

  // 正しい実装
  const correct = parseDateAsUTC('2026-07-30')!;

  expect(buggy.getTime()).not.toBe(correct.getTime());
  // JST(+9) なら前日 15:00 UTC まで戻る＝暦日が 1 日前になる
  expect(buggy.getUTCDate()).toBe(29);
  expect(correct.getUTCDate()).toBe(30);

  // その結果 [buggy, buggy+1) の範囲は 2026-07-30 の @db.Date を取りこぼす
  const buggyEnd = new Date(buggy);
  buggyEnd.setDate(buggyEnd.getDate() + 1);
  const stored = parseDateAsUTC('2026-07-30')!; // DB から読んだ shipDate 相当
  const hitByBuggyRange = stored >= buggy && stored < buggyEnd;
  const hitByCorrectRange =
    stored >= correct && stored < addDaysUTC(correct, 1);
  expect(hitByCorrectRange).toBe(true);
  // ※ 時刻付き Date として比較すると境界内に入るが、@db.Date（DATE 型）へは
  //   暦日に丸めて渡されるため実 DB では 07-29 扱いになり 0 件になる。
  //   ここでは「暦日がズレる」ことを不変条件として固定する。
  expect(formatDateYmd(buggy)).toBe('2026-07-29');
  expect(hitByBuggyRange).toBe(true); // 時刻比較では入る＝見落としやすい罠
});

// ───────────────────────────────────────────────
// 3. 出荷照合ファミリの回帰防止（ソース走査）
//
// 対象を出荷照合（/api/orders/match 配下）に限定する。
// 他のルートには JST 壁時計を意図的に使うもの（mfg の日割り、
// carriers/today の締切時刻、daily-alloc-diff の createdAt 窓）があり、
// 一律禁止にすると誤検知になるため、ここでは範囲を絞る。
// ───────────────────────────────────────────────

const MATCH_API_DIR = path.join(process.cwd(), 'src/app/api/orders/match');

function matchRouteFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === 'route.ts') out.push(p);
    }
  };
  walk(MATCH_API_DIR);
  return out;
}

/** コメント行を落として実コードだけにする（禁止理由の説明文を拾わないため） */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
}

test('出荷照合 API は 3 本すべて検出できている（テストの前提が崩れたら気づく）', () => {
  const rels = matchRouteFiles()
    .map((p) => path.relative(process.cwd(), p).replace(/\\/g, '/'))
    .sort();
  expect(rels).toEqual([
    'src/app/api/orders/match/bulk-action/route.ts',
    'src/app/api/orders/match/carryover/route.ts',
    'src/app/api/orders/match/route.ts',
  ]);
});

test('出荷照合 API は shipDate 範囲を date-utils で導出する', () => {
  const offenders = matchRouteFiles()
    .filter((p) => !/from '@\/lib\/date-utils'/.test(readFileSync(p, 'utf8')))
    .map((p) => path.relative(process.cwd(), p));
  expect(offenders).toEqual([]);
});

test('出荷照合 API は setHours を使わない（一括処理 0 件バグの再発防止）', () => {
  const offenders = matchRouteFiles()
    .filter((p) => /\.setHours\(/.test(codeOnly(readFileSync(p, 'utf8'))))
    .map((p) => path.relative(process.cwd(), p));
  expect(offenders).toEqual([]);
});
