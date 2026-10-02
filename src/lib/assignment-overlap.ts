import { hhmmToMinutes } from './assigned-hours';

/**
 * 同じ担当者の割当が時間で重ならないようにする規則（不具合要望 No.4・久保様 2026-10-01）。
 *
 * 【背景】現場の登録の仕方は「まずベースのテーブルを午前・午後で入れ、あとから
 * 午前または午後だけ別テーブルに差し替える」。ところが差し替えても**ベースが残り**、
 * 同じ時間に2本が重なってバーが同じ位置に描かれ、上のものしか見えなかった。
 * 見えている方を消すと、消したはずの割当が隠れて残る。
 *
 * 実害：ダッシュボードの「配置人数」は割当の件数で数えるため人数が多く出る。
 * 処理能力＝配置人数×60÷標準時間×スキル係数 なので、完了予測が実際より早く出る。
 * 1人が同じ時間に2つの仕事はできないため、重なりは必ず誤り。
 *
 * 【決定】
 *  - **12:00 で終わる割当と 12:00 から始まる割当は重なりとしない**（休憩の前後を登録できるように）
 *  - 画面では「未割当の時間」を初期値にし、重なるときは確認して**置き換え**る
 *  - 置き換えはその時間ぶんだけ。ベースの残り時間は分割して残す
 *  - 保存時（サーバ）にも検査する。「昨日と同じ」等の経路でも重複が入るため
 */

export interface Span {
  startTime: string;
  endTime: string;
}

export interface StaffSpan extends Span {
  staffCode: string;
}

/** 分に直した区間。時刻として読めない／逆転している場合は null。 */
function toRange(s: Span): { from: number; to: number } | null {
  const from = hhmmToMinutes(s.startTime);
  const to = hhmmToMinutes(s.endTime);
  if (from == null || to == null || to <= from) return null;
  return { from, to };
}

/**
 * 2つの区間が重なるか。
 * ★ 端が接するだけ（12:00 終了と 12:00 開始）は**重なりとしない**。
 */
export function overlaps(a: Span, b: Span): boolean {
  const ra = toRange(a);
  const rb = toRange(b);
  if (!ra || !rb) return false;
  return ra.from < rb.to && rb.from < ra.to;
}

/**
 * 同じ担当者で時間が重なっている組を返す（保存前の検査用）。
 * グループが違っても重なりは誤り（1人が同時に2か所では作業できない）。
 */
export function findOverlaps(items: StaffSpan[]): Array<{ a: StaffSpan; b: StaffSpan }> {
  const byStaff = new Map<string, StaffSpan[]>();
  for (const it of items) {
    const list = byStaff.get(it.staffCode);
    if (list) list.push(it);
    else byStaff.set(it.staffCode, [it]);
  }

  const found: Array<{ a: StaffSpan; b: StaffSpan }> = [];
  for (const list of byStaff.values()) {
    // 開始順に並べ、隣同士だけ見れば足りる…とはせず総当たり。
    //   1人あたり数本しかなく、取りこぼしを作らないことを優先する。
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (overlaps(list[i]!, list[j]!)) found.push({ a: list[i]!, b: list[j]! });
      }
    }
  }
  return found;
}

/**
 * ある担当者の「まだ割当の無い時間」を返す（割当ピッカーの初期値に使う）。
 *
 * @param existing その担当者の既存割当
 * @param workFrom 勤務開始（"HH:MM"）
 * @param workTo   勤務終了（"HH:MM"）
 * @returns 空き時間の配列（開始順）。空きが無ければ空配列
 */
export function freeSpans(existing: Span[], workFrom: string, workTo: string): Span[] {
  const work = toRange({ startTime: workFrom, endTime: workTo });
  if (!work) return [];

  const used = existing
    .map(toRange)
    .filter((r): r is { from: number; to: number } => r !== null)
    .sort((x, y) => x.from - y.from);

  const free: Array<{ from: number; to: number }> = [];
  let cursor = work.from;
  for (const u of used) {
    if (u.to <= cursor) continue; // すでに通り過ぎた
    if (u.from > cursor) free.push({ from: cursor, to: Math.min(u.from, work.to) });
    cursor = Math.max(cursor, u.to);
    if (cursor >= work.to) break;
  }
  if (cursor < work.to) free.push({ from: cursor, to: work.to });

  return free
    .filter((f) => f.to > f.from)
    .map((f) => ({ startTime: minutesToHHMM(f.from), endTime: minutesToHHMM(f.to) }));
}

/** 分 → "HH:MM"。 */
export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 既存の割当から、新しく入れる時間帯のぶんだけを**切り抜く**。
 *
 * 現場の操作「9:00〜16:00 の ABCSML に 13:00〜16:00 の DOKON-K を置き換える」で、
 * ベースの残り（9:00〜13:00 の ABCSML）を自動で残すために使う。
 *
 * @returns 置き換え後に残すべき区間（0本＝まるごと消える / 1本 / 2本＝中抜き）
 */
export function subtractSpan(base: Span, cut: Span): Span[] {
  const b = toRange(base);
  const c = toRange(cut);
  if (!b) return [];
  if (!c) return [base];
  if (c.to <= b.from || c.from >= b.to) return [base]; // 重ならない

  const out: Span[] = [];
  if (b.from < c.from) out.push({ startTime: minutesToHHMM(b.from), endTime: minutesToHHMM(c.from) });
  if (c.to < b.to) out.push({ startTime: minutesToHHMM(c.to), endTime: minutesToHHMM(b.to) });
  return out;
}

/** 重なりを人が読める1行にする（確認ダイアログ・保存エラー用）。 */
export function describeOverlap(staffName: string, a: Span, b: Span): string {
  return `${staffName}：${a.startTime}〜${a.endTime} と ${b.startTime}〜${b.endTime} が重なっています`;
}
