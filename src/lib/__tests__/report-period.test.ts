/**
 * レポート期間ヘルパー（report-period）のテスト
 *
 * 実行: npm test
 *
 * `parsePeriod` の from/to は **2 種類の列**に使われている：
 *
 *   - `createdAt` 等（Prisma `@db.Timestamptz`）… 時刻を持つ。
 *     JST ローカル日の 00:00:00.000〜23:59:59.999 で切るのが正しい（現行どおり）。
 *   - `shipDate`（Prisma `@db.Date`）… 時刻を持たず UTC 真夜中で読み書きされる。
 *     UTC 真夜中の暦日境界で切る必要がある。
 *
 * 同じ from/to を両方に使うと `@db.Date` 側で暦日が 1 日ズレる：
 *   from='2026-07-01' → JST 真夜中 = 2026-06-30T15:00Z → 暦日 2026-06-30
 *   → gte が前月末を含み、集計に 1 日分が余計に入る。
 *
 * そのため `@db.Date` 用に `fromDate` / `toDateExclusive`（UTC 真夜中）を分けて返す。
 */

import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parsePeriod } from '../report-period';

function ok(from: string, to: string) {
  const r = parsePeriod(from, to);
  if ('error' in r) throw new Error('想定外のバリデーションエラー');
  return r;
}

// ───────────────────────────────────────────────
// 1. Timestamptz 用の from/to（既存挙動を壊さないための固定）
// ───────────────────────────────────────────────

test('from/to は JST ローカル日の境界（createdAt 等の Timestamptz 用・既存挙動）', () => {
  const r = ok('2026-07-01', '2026-07-31');
  // JST(+9) の 07-01 00:00 は 06-30T15:00Z
  expect(r.from.toISOString()).toBe('2026-06-30T15:00:00.000Z');
  // JST の 07-31 23:59:59.999 は 07-31T14:59:59.999Z
  expect(r.to.toISOString()).toBe('2026-07-31T14:59:59.999Z');
});

// ───────────────────────────────────────────────
// 2. @db.Date 用の fromDate/toDateExclusive
// ───────────────────────────────────────────────

test('fromDate / toDateExclusive は UTC 真夜中（@db.Date 用）', () => {
  const r = ok('2026-07-01', '2026-07-31');
  expect(r.fromDate.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  // 終端は「含まない」ので to の翌日
  expect(r.toDateExclusive.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  // TZ に関係なく UTC 時刻成分は必ず 0
  expect(r.fromDate.getUTCHours()).toBe(0);
  expect(r.toDateExclusive.getUTCHours()).toBe(0);
});

test('回帰: fromDate は前日を含まない（旧実装は前月末を巻き込んでいた）', () => {
  const r = ok('2026-07-01', '2026-07-31');
  // DB の shipDate 相当（UTC 真夜中）
  const jun30 = new Date('2026-06-30T00:00:00.000Z');
  const jul01 = new Date('2026-07-01T00:00:00.000Z');
  const jul31 = new Date('2026-07-31T00:00:00.000Z');
  const aug01 = new Date('2026-08-01T00:00:00.000Z');

  const inRange = (d: Date) => d >= r.fromDate && d < r.toDateExclusive;
  expect(inRange(jun30)).toBe(false); // 前日は入らない
  expect(inRange(jul01)).toBe(true);
  expect(inRange(jul31)).toBe(true); // 終端日は入る
  expect(inRange(aug01)).toBe(false);

  // 旧実装が前日を巻き込む機構：@db.Date 列へ渡す際は時刻が落ちて
  // 「UTC の暦日」に丸められるため、JST 境界の from は前日として扱われる。
  const utcYmd = (d: Date) => d.toISOString().slice(0, 10);
  expect(utcYmd(r.from)).toBe('2026-06-30'); // ← from の暦日は前日
  expect(utcYmd(r.fromDate)).toBe('2026-07-01'); // ← fromDate は正しく当日
});

test('単日指定でもその 1 日だけを含む', () => {
  const r = ok('2026-07-30', '2026-07-30');
  expect(r.fromDate.toISOString()).toBe('2026-07-30T00:00:00.000Z');
  expect(r.toDateExclusive.toISOString()).toBe('2026-07-31T00:00:00.000Z');
});

test('月末・年末を越えても UTC 暦日で正しく進む', () => {
  expect(ok('2026-12-31', '2026-12-31').toDateExclusive.toISOString()).toBe(
    '2027-01-01T00:00:00.000Z',
  );
  expect(ok('2028-02-01', '2028-02-29').toDateExclusive.toISOString()).toBe(
    '2028-03-01T00:00:00.000Z',
  );
});

test('バリデーションは従来どおり（必須・形式・順序・上限）', () => {
  expect('error' in parsePeriod(null, '2026-07-31')).toBe(true);
  expect('error' in parsePeriod('2026/07/01', '2026-07-31')).toBe(true);
  expect('error' in parsePeriod('2026-07-31', '2026-07-01')).toBe(true);
  expect('error' in parsePeriod('2020-01-01', '2026-07-31')).toBe(true); // 366日超
  expect('error' in parsePeriod('2026-07-01', '2026-07-31')).toBe(false);
});

// ───────────────────────────────────────────────
// 3. 回帰防止: shipDate を from/to で絞っていないこと
// ───────────────────────────────────────────────

// 2026-08-07：本ガードが `src/lib/reports.ts` を見ていなかったため、
//   KPI「総出荷数」だけが前日1日分を過大計上したままドリルダウンと食い違う、という
//   最大の適用漏れがすり抜けていた。集計ロジック本体も対象に含める。
const SHIPDATE_REPORT_ROUTES = [
  'src/app/api/report/carrier/route.ts',
  'src/app/api/report/drill/total-ship/route.ts',
  'src/app/api/report/force/route.ts',
  'src/lib/reports.ts',
];

test('shipDate を絞るレポート API は from/to ではなく fromDate/toDateExclusive を使う', () => {
  const offenders: string[] = [];
  for (const rel of SHIPDATE_REPORT_ROUTES) {
    const src = readFileSync(path.join(process.cwd(), rel), 'utf8');
    // shipDate: { gte: from, ... } / lte: to を検出（@db.Date に Timestamptz 境界を流用）
    const m = src.match(/shipDate:\s*\{[^}]*\}/g) ?? [];
    if (m.some((s) => /\bgte:\s*from\b/.test(s) || /\blte:\s*to\b/.test(s))) {
      offenders.push(rel);
    }
  }
  expect(offenders).toEqual([]);
});

// ── @db.Date に setHours 由来の境界を流用していないか（2026-08-07 追加）──
//   `shipDate` / `targetDate` / `date`（いずれも @db.Date）を startOf()/endOf() や
//   setHours(0,0,0,0) の Date で絞ると、JST では前日1日分がずれて混ざる。
const DATE_COLUMN_FILES = [
  'src/lib/reports.ts',
  'src/lib/dashboard/badges.ts',
];

test('@db.Date 列を startOf/endOf の境界で絞っていない', () => {
  const offenders: string[] = [];
  for (const rel of DATE_COLUMN_FILES) {
    const src = readFileSync(path.join(process.cwd(), rel), 'utf8');
    const blocks = src.match(/shipDate:\s*\{[^}]*\}/g) ?? [];
    if (blocks.some((b) => /startOf\(|endOf\(/.test(b))) offenders.push(rel);
  }
  expect(offenders).toEqual([]);
});

test('日別集計のバケットキーは JST 暦日（jstYmd）で作る', () => {
  // completedAt は @db.Timestamptz。toISOString().slice(0,10) だと UTC 暦日になり
  // JST 00:00〜08:59 完了分が前日に混ざる（2026-08-07 是正）。
  const src = readFileSync(path.join(process.cwd(), 'src/lib/reports.ts'), 'utf8');
  expect(src).toContain('jstYmd');
  expect(src).not.toMatch(/completedAt\.toISOString\(\)\.slice\(0,\s*10\)/);
});

test('管理画面の既定日は UTC 日ではなく JST 暦日で作る', () => {
  // JST 早朝に開くと前日が既定になり、一括処理が前日の伝票を対象にしてしまう
  const files = [
    'src/app/(admin)/dashboard/_components/panes/match-pane.tsx',
    'src/app/(admin)/dashboard/_components/panes/report/report-period-context.tsx',
  ];
  const offenders: string[] = [];
  for (const rel of files) {
    const src = readFileSync(path.join(process.cwd(), rel), 'utf8');
    if (/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(src)) offenders.push(rel);
    if (/today\.setHours\(0,\s*0,\s*0,\s*0\)/.test(src)) offenders.push(rel);
  }
  expect(offenders).toEqual([]);
});
