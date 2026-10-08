/**
 * 作業ペース（件/時）を**スキャン実績**から出す純ロジック。
 *
 * 出典：変更要望（3件）久保様 2026-10-04 — No.1 / No.2 / No.3
 *
 *   > 作業ペースの分母を、割当の合計時間ではなく、スキャン記録から出した実働時間に
 *   > してください。分母 = 最初のスキャン着手 〜 現在（または最後の完了）− 昼休憩の控除
 *   > 「行き来」の判定を、メンバー割当ではなく、スキャンした伝票の実績で行ってください。
 *
 * ★ 2026-09-28 に「実働時間はメンバー割当の配置時間（MHT）を使う」と決めていたが、
 *   運用して次の2点が分かったため、**スキャン実績に改める**（小原様 2026-10-08 了承）。
 *
 *   1. 割当にはスキャン記録の残らない作業（前裁きなど）や午後の予定も入る。
 *      分母が実際の作業時間より大きくなり、🟢 の人に 🔴 が出ていた。
 *      （矢部さん 2026-10-02 午前：実測 78.9 件/時 → 画面 27.9 件/時）
 *   2. 昼休憩で割当が2本に分かれる人が「同じテーブルを行き来した」と判定され、
 *      昼休憩を取る人のほぼ全員でペースが出なかった。
 *
 * 分子（件）は**伝票枚数**。商品点数ではない（要望書 2026-09-27 から変わらず）。
 *
 * ★ 現場の自己確認用であり、評価目的ではない。数字が出せないときに
 *   憶測の値を出すより「—」を出す方がよい、という前提で閾値を置いている。
 *
 * DB へは触らない。純関数だけを置く。
 */

import { perHourRate } from './work-pace';

/** 昼休憩を探す時間帯（JST 0時からの分）。 */
export const LUNCH_FROM_MIN = 12 * 60;
export const LUNCH_TO_MIN = 13 * 60;

/**
 * 数字を出すのに必要な実働分。
 * 1件目の直後に値が跳ねるのを防ぐ（要望 No.1）。
 */
export const MIN_WORKED_MIN = 30;

/**
 * 数字を出すのに必要な件数（要望 No.3）。
 * 手伝いで数件だけ触ったテーブルに 🔴 を出さないための下限。
 */
export const MIN_COUNT = 15;

/** 検品セッション1件（＝伝票1枚）。時刻は JST 0時からの分。 */
export interface ScanRecord {
  /** テーブルグループ。未分類の伝票は呼び出し側で除いておく */
  groupId: string;
  /** 検品着手 */
  startMin: number;
  /** 検品完了。保留中・作業中は null */
  endMin: number | null;
}

/** 数字を出せない理由。null なら出せている。 */
export type PaceSkipReason = 'revisit' | 'too_short' | 'too_few' | 'no_scan' | null;

export interface GroupPace {
  groupId: string;
  /** 完了した伝票の枚数 */
  count: number;
  /** 実働分（最初の着手〜最後の完了 − 昼休憩） */
  workedMin: number;
  /** 件/時（小数1桁）。出せないときは null */
  perHour: number | null;
  /** 同じグループに1日で2回以上戻ったか */
  revisit: boolean;
  reason: PaceSkipReason;
}

/** 区間の重なり（分）。 */
function overlapMin(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/**
 * 12:00〜13:00 のうち、**スキャンが1件も無かった最長の空き**を返す（＝昼休憩とみなす）。
 *
 * 休憩の時刻を設定で持たせない（要望 No.1「設定を増やさず自動にする」）。
 * 休憩を取らない人はその時間にスキャンが続くので、空きはほぼ 0 分になる。
 *
 * 「スキャン」は着手と完了のイベントで見る。区間（着手〜完了）で塞がっているとは
 * 見ない：保留した伝票は完了が数時間後になることがあり、その1枚で昼をまたいで
 * しまうと、休憩を取った人の控除が消えるため。
 *
 * @returns 休憩とみなす区間。空きが無ければ null
 */
export function lunchGap(records: ScanRecord[]): { from: number; to: number } | null {
  const marks: number[] = [LUNCH_FROM_MIN, LUNCH_TO_MIN];
  for (const r of records) {
    if (r.startMin > LUNCH_FROM_MIN && r.startMin < LUNCH_TO_MIN) marks.push(r.startMin);
    if (r.endMin != null && r.endMin > LUNCH_FROM_MIN && r.endMin < LUNCH_TO_MIN) {
      marks.push(r.endMin);
    }
  }
  marks.sort((a, b) => a - b);

  let from = LUNCH_FROM_MIN;
  let to = LUNCH_FROM_MIN;
  for (let i = 1; i < marks.length; i++) {
    const prev = marks[i - 1]!;
    const cur = marks[i]!;
    if (cur - prev > to - from) {
      from = prev;
      to = cur;
    }
  }
  return to > from ? { from, to } : null;
}

/**
 * 「行き来」したグループ（要望 No.2）。
 *
 * その人が本日スキャンした伝票を**着手時刻の順**に並べ、グループが続いている
 * ひとまとまりを1ブロックと数える。同じグループが2ブロック以上に現れたら行き来。
 *
 *   同梱 同梱 同梱                   → 同梱 1ブロック（昼休憩を挟んでも1つ）
 *   同梱 同梱 ABCSML 同梱            → 同梱 2ブロック＝行き来
 *   ABCSML…（午前） I…（午後）        → それぞれ1ブロック（通常の2テーブル勤務）
 *
 * 並べ替えを完了時刻にしないのは、保留した伝票の完了が数時間後になり、
 * 実際には連続していた作業が飛び飛びに見えるため（要望 No.2）。
 */
export function revisitGroups(records: ScanRecord[]): Set<string> {
  const sorted = [...records].sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    const ae = a.endMin ?? Number.MAX_SAFE_INTEGER;
    const be = b.endMin ?? Number.MAX_SAFE_INTEGER;
    if (ae !== be) return ae - be;
    return a.groupId.localeCompare(b.groupId);
  });

  const blocks = new Map<string, number>();
  let prev: string | null = null;
  for (const r of sorted) {
    if (r.groupId !== prev) blocks.set(r.groupId, (blocks.get(r.groupId) ?? 0) + 1);
    prev = r.groupId;
  }

  const out = new Set<string>();
  for (const [gid, n] of blocks) if (n >= 2) out.add(gid);
  return out;
}

/**
 * グループごとの作業ペース。**件数の多い順**に返す（要望 No.3 の並び順）。
 *
 * 実働分 ＝ そのグループで数えた伝票の「最初の着手 〜 最後の完了」− 昼休憩。
 * 完了していない伝票（保留中・作業中）は、分子にも分母にも入れない。
 */
export function paceByGroup(records: ScanRecord[]): GroupPace[] {
  const gap = lunchGap(records);
  const revisited = revisitGroups(records);

  const byGroup = new Map<string, ScanRecord[]>();
  for (const r of records) {
    const list = byGroup.get(r.groupId);
    if (list) list.push(r);
    else byGroup.set(r.groupId, [r]);
  }

  const out: GroupPace[] = [];
  for (const [groupId, items] of byGroup) {
    const done = items.filter(
      (r): r is ScanRecord & { endMin: number } => r.endMin != null && r.endMin >= r.startMin,
    );
    const revisit = revisited.has(groupId);
    const count = done.length;

    if (count === 0) {
      out.push({ groupId, count: 0, workedMin: 0, perHour: null, revisit, reason: 'no_scan' });
      continue;
    }

    const from = Math.min(...done.map((r) => r.startMin));
    const to = Math.max(...done.map((r) => r.endMin));
    const breakMin = gap ? overlapMin(from, to, gap.from, gap.to) : 0;
    const workedMin = Math.max(0, to - from - breakMin);

    const reason: PaceSkipReason = revisit
      ? 'revisit'
      : workedMin < MIN_WORKED_MIN
        ? 'too_short'
        : count < MIN_COUNT
          ? 'too_few'
          : null;

    out.push({
      groupId,
      count,
      workedMin,
      perHour: reason ? null : perHourRate(count, workedMin),
      revisit,
      reason,
    });
  }

  return out.sort((a, b) => b.count - a.count || a.groupId.localeCompare(b.groupId));
}
