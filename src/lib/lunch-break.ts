import { normalizeHHMM } from './date-utils';

/**
 * 勤務時間から昼休憩を抜く（不具合要望 No.1・久保様 2026-10-01）。
 *
 * 【背景】メンバー割当で H7(8:00〜17:00) を割り当てると休憩が除かれず1本で登録され、
 * 実働が1時間長く計算されていた。A6・A7・B7・D7・G7 などは2本に分かれる。
 *
 * 原因は、休憩を抜く対象が**画面プログラム内の固定リスト**
 * （A6,A7,A8,A9,B6,B7,B9,D5,D6,D7,G6,G7）になっており H7 が入っていなかったこと。
 * マスタ「シフトパターン」の休憩時間（H7 は 60 分）は参照されていなかった。
 *
 * 【決定】**マスタの休憩時間（breakMin）が 0 より大きいかで判定する**。
 * パターンを足しても画面の修正が要らなくなる（今回のような取りこぼしが再発しない）。
 *
 * 影響（要望書より）：実働が1時間長いと、現場端末の作業ペースが約12%低く出て
 * 🟢🟡🔴 の判定がずれ、12:00〜13:00 に配置済みとして数えられる。
 */

/** 昼休憩の時間帯。現状は全パターン共通で 12:00〜13:00（要望書の記載どおり）。 */
export const LUNCH_START = '12:00';
export const LUNCH_END = '13:00';

export interface TimeSpan {
  startTime: string;
  endTime: string;
}

/**
 * 勤務 [start, end] から昼休憩を抜いた時間帯を返す。
 *
 * - `breakMin` が 0 以下／未設定 … 休憩なし。1本のまま
 * - 勤務が昼休憩と重ならない（午後開始・午前で終業）… 1本のまま
 * - それ以外 … 12:00 で区切って2本にする
 *
 * 時刻は "HH:MM" に正規化して返す。正規化できない値は原値のまま返し、
 * 保存時のガードで不備として検出させる（従来の挙動を踏襲）。
 */
export function splitByLunchBreak(
  rawStart: string,
  rawEnd: string,
  breakMin: number | null | undefined,
): TimeSpan[] {
  const startTime = normalizeHHMM(rawStart);
  const endTime = normalizeHHMM(rawEnd);
  if (!startTime || !endTime) return [{ startTime: rawStart, endTime: rawEnd }];

  // ★ 固定のパターン一覧ではなく、マスタの休憩時間で判定する
  if (!breakMin || breakMin <= 0) return [{ startTime, endTime }];

  // 勤務が休憩帯と重ならない（午後開始／午前で終業）→ そのまま
  if (endTime <= LUNCH_START || startTime >= LUNCH_END) return [{ startTime, endTime }];

  const segs: TimeSpan[] = [];
  if (startTime < LUNCH_START) segs.push({ startTime, endTime: LUNCH_START });
  if (endTime > LUNCH_END) segs.push({ startTime: LUNCH_END, endTime });
  return segs.length ? segs : [{ startTime, endTime }];
}
