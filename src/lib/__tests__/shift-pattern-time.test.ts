import { describe, it, expect } from 'vitest';
import { normalizePatternTimes } from '../shift-pattern-time';
import { normalizeHHMM } from '../date-utils';

/**
 * シフトパターンの時刻欄（不具合要望 No.3・久保様 2026-10-01）。
 *
 * 実際にマスタへ保存され、割当を壊した値をそのまま固定する：
 *   "8：00"（全角コロン）… 時刻として読めず、割当が既定の 8:30-17:30 にずれた
 *   "8:00"（ゼロなし）  … 文字列比較で "17:00" <= "8:00" となり割当を登録できなくなった
 *   "1700"（コロンなし）… 同種の不具合の恐れ
 *
 * 固定したいこと：**保存されるのは必ず "HH:MM"（半角・ゼロ付き2桁）だけ**。
 */

describe('normalizeHHMM（全角も受け付ける）', () => {
  it('★ 全角コロン "8：00" を 08:00 に直す（今回の事故の値）', () => {
    expect(normalizeHHMM('8：00')).toBe('08:00');
  });

  it('★ 全角数字 "８：００" も直す', () => {
    expect(normalizeHHMM('８：００')).toBe('08:00');
  });

  it('ゼロなし "8:00" → 08:00', () => {
    expect(normalizeHHMM('8:00')).toBe('08:00');
  });

  it('コロンなし "1700" → 17:00', () => {
    expect(normalizeHHMM('1700')).toBe('17:00');
  });

  it('すでに正しい値はそのまま', () => {
    expect(normalizeHHMM('08:00')).toBe('08:00');
    expect(normalizeHHMM('17:30')).toBe('17:30');
  });

  it('時刻として読めないものは空文字', () => {
    expect(normalizeHHMM('あさ8時')).toBe('');
    expect(normalizeHHMM('25:00')).toBe('');
    expect(normalizeHHMM('08:70')).toBe('');
    expect(normalizeHHMM('')).toBe('');
  });
});

describe('normalizePatternTimes', () => {
  it('★ 事故になった3つの値が、すべて HH:MM に直って保存される', () => {
    expect(normalizePatternTimes({ startTime: '8：00', endTime: '17:00' })).toEqual({
      ok: true,
      startTime: '08:00',
      endTime: '17:00',
    });
    expect(normalizePatternTimes({ startTime: '8:00', endTime: '1700' })).toEqual({
      ok: true,
      startTime: '08:00',
      endTime: '17:00',
    });
  });

  it('時刻を持たないパターン（公休・有休）は空・null を許容', () => {
    expect(normalizePatternTimes({ startTime: null, endTime: null })).toEqual({
      ok: true,
      startTime: null,
      endTime: null,
    });
    expect(normalizePatternTimes({ startTime: '', endTime: '  ' })).toEqual({
      ok: true,
      startTime: null,
      endTime: null,
    });
    expect(normalizePatternTimes({})).toEqual({ ok: true, startTime: null, endTime: null });
  });

  it('★ 読めない値は拒否し、どの欄か・何を入れた値かが分かる', () => {
    const r = normalizePatternTimes({ startTime: 'あさ8時', endTime: '17:00' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('開始時刻');
      expect(r.error).toContain('HH:MM');
      expect(r.error).toContain('あさ8時');
    }
  });

  it('終了時刻側のエラーも同様に分かる', () => {
    const r = normalizePatternTimes({ startTime: '08:00', endTime: '99:99' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('終了時刻');
  });

  it('★ 開始 ≧ 終了 は拒否しない（夜勤など日跨ぎをマスタに登録できなくしない）', () => {
    expect(normalizePatternTimes({ startTime: '22:00', endTime: '06:00' })).toEqual({
      ok: true,
      startTime: '22:00',
      endTime: '06:00',
    });
  });

  it('何度通しても結果が変わらない（冪等）', () => {
    const first = normalizePatternTimes({ startTime: '8：00', endTime: '1700' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(normalizePatternTimes({ startTime: first.startTime, endTime: first.endTime })).toEqual(
      first,
    );
  });
});
