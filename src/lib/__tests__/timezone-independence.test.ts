import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  todayJstAsUTC,
  jstYmd,
  jstHour,
  jstMinute,
  jstWeekday,
  jstHm,
  jstMdHm,
  jstDayStart,
  jstDayEnd,
  parseDateAsUTC,
  formatDateYmd,
} from '../date-utils';

/**
 * 日付・時刻の扱いが**実行環境のタイムゾーンに依存しない**ことのロックテスト。
 *
 * ★ CI は TZ=UTC と TZ=Asia/Tokyo の2回まわす。どちらでも同じ結果になること。
 *
 * 背景（2026-10-01）：姉妹システム CraftSmile で、本番コンテナ（Alpine）に tzdata が
 * 無く `TZ=Asia/Tokyo` が黙って無視され、日本時間 0:00〜8:59 のあいだ暦日が1日ずれた。
 * 本リポジトリは Debian イメージのおかげで**たまたま**成立していたが、
 *
 *   - `report-period.ts` の期間境界（setHours）
 *   - ダッシュボード／レポートの時間帯バケット（getHours）
 *
 * が同じ依存を抱えていた。TZ 設定が効かなくなっても正しいことをここで固定する。
 */

const at = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

describe('todayJstAsUTC（いまの日本の暦日）', () => {
  afterEach(() => vi.useRealTimers());

  it('★ 日本時間の朝5時でも当日（UTC では前日20時）', () => {
    at('2026-10-01T20:00:00Z');
    expect(formatDateYmd(todayJstAsUTC())).toBe('2026-10-02');
  });

  it('日本時間 0:00 / 8:59 / 9:00 / 23:59 のどこでも当日', () => {
    for (const [iso, ymd] of [
      ['2026-10-01T15:00:00Z', '2026-10-02'], // 0:00 JST
      ['2026-10-01T23:59:00Z', '2026-10-02'], // 8:59 JST
      ['2026-10-02T00:00:00Z', '2026-10-02'], // 9:00 JST
      ['2026-10-02T14:59:00Z', '2026-10-02'], // 23:59 JST
    ] as const) {
      at(iso);
      expect(formatDateYmd(todayJstAsUTC())).toBe(ymd);
    }
  });

  it('年跨ぎの深夜', () => {
    at('2026-12-31T15:00:00Z'); // 2027/1/1 00:00 JST
    expect(formatDateYmd(todayJstAsUTC())).toBe('2027-01-01');
  });
});

describe('jstDayStart / jstDayEnd（Timestamptz の範囲指定）', () => {
  it('★ 暦日 → その日の JST 00:00 / 23:59:59.999 の瞬間', () => {
    const d = parseDateAsUTC('2026-07-01')!;
    expect(jstDayStart(d).toISOString()).toBe('2026-06-30T15:00:00.000Z');
    expect(jstDayEnd(d).toISOString()).toBe('2026-07-01T14:59:59.999Z');
  });

  it('範囲は日本時間の1日ぶんをちょうど覆う', () => {
    const d = parseDateAsUTC('2026-07-01')!;
    const from = jstDayStart(d);
    const to = jstDayEnd(d);
    // 7/1 00:00 JST に完了した検品は入る
    expect(new Date('2026-06-30T15:00:00.000Z') >= from).toBe(true);
    // 6/30 23:59 JST は入らない
    expect(new Date('2026-06-30T14:59:00.000Z') >= from).toBe(false);
    // 7/1 23:59 JST は入る
    expect(new Date('2026-07-01T14:59:00.000Z') <= to).toBe(true);
    // 7/2 00:00 JST は入らない
    expect(new Date('2026-07-01T15:00:00.000Z') <= to).toBe(false);
  });
});

describe('時刻を JST として読む（ヒートマップ・進捗の時間帯）', () => {
  it('★ jstHour は +9時間で読む（UTC の時ではない）', () => {
    // 2026-10-02 01:30 JST
    const d = new Date('2026-10-01T16:30:00Z');
    expect(jstHour(d)).toBe(1);
    expect(jstMinute(d)).toBe(30);
    expect(jstHm(d)).toBe('01:30');
  });

  it('日中の時刻', () => {
    const d = new Date('2026-10-02T05:15:00Z'); // 14:15 JST
    expect(jstHour(d)).toBe(14);
    expect(jstHm(d)).toBe('14:15');
    expect(jstMdHm(d)).toBe('10/2 14:15');
    expect(jstMdHm(d, { pad: true })).toBe('10/02 14:15');
  });

  it('★ 曜日も JST で判定する（深夜は前日扱いにならない）', () => {
    // 2026-10-02(金) 01:00 JST ＝ 2026-10-01(木) 16:00 UTC
    const d = new Date('2026-10-01T16:00:00Z');
    expect(jstWeekday(d)).toBe(5); // 金曜
    expect(d.getUTCDay()).toBe(4); // UTC では木曜（＝これを使うとずれる）
  });

  it('日跨ぎの表示が前日にならない', () => {
    const d = new Date('2026-10-01T15:30:00Z'); // 10/2 00:30 JST
    expect(jstMdHm(d)).toBe('10/2 00:30');
    expect(jstYmd(d)).toBe('2026-10-02');
    // toISOString().slice(0,10) だと前日になる組み合わせ
    expect(d.toISOString().slice(0, 10)).toBe('2026-10-01');
  });
});
