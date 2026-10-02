import { normalizeHHMM } from './date-utils';

/**
 * シフトパターンの時刻欄の検証・正規化（不具合要望 No.3・2026-10-01 久保様）。
 *
 * 【背景】マスタ「シフトパターン」の開始・終了時刻は `z.string().max(5)` しか
 * 見ておらず、次のような値がそのまま保存できていた。
 *
 *   "8：00"  … 全角コロン。時刻として読めず、割当が既定の 8:30-17:30 にずれる
 *   "8:00"   … ゼロなし。文字列比較のため "17:00" <= "8:00" が成り立ち、
 *              「終了時刻は開始時刻より後にしてください」で割当を登録できなくなる
 *   "1700"   … コロンなし
 *
 * 【方針】**保存されるのは必ず "HH:MM"（半角・ゼロ付き2桁）だけ**にする。
 *   ただし入力を突き返すだけでは現場が困るため、全角・ゼロなし・コロンなしは
 *   `normalizeHHMM` で機械的に直してから保存する（打ち直しをさせない）。
 *   どうしても時刻として読めないものだけを 422 で拒否する。
 *
 * 時刻を持たないパターン（公休・有休など）もあるため、空と null は許容する。
 */

export interface PatternTimeInput {
  startTime?: string | null;
  endTime?: string | null;
}

export type PatternTimeResult =
  | { ok: true; startTime: string | null; endTime: string | null }
  | { ok: false; error: string };

/** 1つぶんの時刻欄を正規化する。空・null はそのまま null。 */
function one(
  label: string,
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: null };
  const trimmed = String(raw).trim();
  if (trimmed === '') return { ok: true, value: null };

  const normalized = normalizeHHMM(trimmed);
  if (normalized === '') {
    return {
      ok: false,
      error: `${label}は 24時間制の「HH:MM」で入力してください（例: 08:00）。入力値: ${trimmed}`,
    };
  }
  return { ok: true, value: normalized };
}

/**
 * 開始・終了時刻をまとめて検証・正規化する。
 * 戻り値の時刻は必ず "HH:MM"（半角・ゼロ付き2桁）か null。
 */
export function normalizePatternTimes(input: PatternTimeInput): PatternTimeResult {
  const start = one('開始時刻', input.startTime);
  if (!start.ok) return { ok: false, error: start.error };
  const end = one('終了時刻', input.endTime);
  if (!end.ok) return { ok: false, error: end.error };

  // ★ 開始 < 終了 はここでは強制しない。
  //   夜勤など日をまたぐパターンをマスタに登録できなくなるため。
  //   割当画面の入力チェックは「時刻として」比較する（文字列比較をやめた）。
  return { ok: true, startTime: start.value, endTime: end.value };
}
