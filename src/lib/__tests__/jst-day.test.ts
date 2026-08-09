/**
 * JST 暦日キーのテスト（2026-08-07）
 *
 * 背景：レポートの日別集計が `completedAt.toISOString().slice(0,10)` で
 *   バケットキーを作っていた。`completedAt` は `@db.Timestamptz`（インスタント）なので
 *   これは **UTC の暦日**になる。JST の朝〜8:59 に完了した検品セッションは
 *   前日に振り分けられ、日別グラフ・担当者別MHが1日ずれる。
 *
 *   例：JST 2026-08-07 07:00 に完了 → UTC 2026-08-06 22:00 → キー "2026-08-06"
 *
 *   `shipDate` は `@db.Date`（UTC 真夜中）なので toISOString でも正しい暦日になり、
 *   同じ関数の中で **2種類のキーが混在**していた。
 */

import { describe, it, expect } from 'vitest';
import { jstYmd } from '../date-utils';

describe('jstYmd — インスタントを JST の暦日にする', () => {
  it('★ JST 早朝（UTC では前日）が当日になる', () => {
    // JST 2026-08-07 07:00 = UTC 2026-08-06 22:00
    expect(jstYmd(new Date('2026-08-06T22:00:00.000Z'))).toBe('2026-08-07');
  });

  it('JST 深夜0時ちょうど（UTC 前日15:00）', () => {
    expect(jstYmd(new Date('2026-08-06T15:00:00.000Z'))).toBe('2026-08-07');
  });

  it('JST 23:59:59（UTC 同日14:59:59）', () => {
    expect(jstYmd(new Date('2026-08-07T14:59:59.999Z'))).toBe('2026-08-07');
  });

  it('JST 深夜0時の1ミリ秒前は前日', () => {
    expect(jstYmd(new Date('2026-08-06T14:59:59.999Z'))).toBe('2026-08-06');
  });

  it('日中は UTC と同じ日', () => {
    expect(jstYmd(new Date('2026-08-07T03:00:00.000Z'))).toBe('2026-08-07');
  });

  it('月跨ぎ', () => {
    // JST 2026-09-01 00:30 = UTC 2026-08-31 15:30
    expect(jstYmd(new Date('2026-08-31T15:30:00.000Z'))).toBe('2026-09-01');
  });

  it('年跨ぎ', () => {
    // JST 2027-01-01 08:00 = UTC 2026-12-31 23:00
    expect(jstYmd(new Date('2026-12-31T23:00:00.000Z'))).toBe('2027-01-01');
  });

  it('@db.Date（UTC真夜中）を渡しても暦日は変わらない', () => {
    // shipDate は UTC 00:00 で保存される。+9h しても同じ日のまま
    expect(jstYmd(new Date('2026-08-07T00:00:00.000Z'))).toBe('2026-08-07');
  });

  it('サーバのタイムゾーン設定に依存しない（UTC計算のみ）', () => {
    const d = new Date('2026-08-06T22:00:00.000Z');
    const before = process.env.TZ;
    process.env.TZ = 'UTC';
    const a = jstYmd(d);
    process.env.TZ = 'America/New_York';
    const b = jstYmd(d);
    process.env.TZ = before;
    expect(a).toBe('2026-08-07');
    expect(b).toBe('2026-08-07');
  });
});
