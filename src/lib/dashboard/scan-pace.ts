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
 * ★ 2026-10-10 改訂（変更要望「個人進捗の作業ペースを『テーブル別』の表示に一本化する」）。
 *
 *   - 作業時間を「最初の着手〜最後の完了」から、**塊（ブロック）ごとの時間の合計**に改めた。
 *     間に挟んだ別のテーブルの時間が混ざらなくなる。
 *   - その結果「同じテーブルを行き来した日は集計対象外」という扱いが**不要になった**ので
 *     やめた。2026-10-01〜10-10 の実績では、15件以上スキャンした 75人日のうち
 *     **23人日（約3割）** が短い手伝いのせいで主なテーブルの成績を見られなかった。
 *     （有本さん 10/10：同梱を 09:21〜14:43 に 128件こなした日が「集計対象外」）
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

/**
 * 塊（ブロック）＝ スキャンを着手時刻の順に並べたとき、同じテーブルが連続している範囲。
 *
 * 時間は「塊の最初の伝票の着手 〜 塊の最後の伝票の完了」。
 * 完了していない伝票（保留中）は、終わりを決める材料にしない。
 */
export interface GroupBlock {
  groupId: string;
  from: number;
  /** 完了した伝票が1枚も無い塊は null（時間を持たない） */
  to: number | null;
  /** この塊で完了した伝票の枚数 */
  count: number;
}

export interface GroupPace {
  groupId: string;
  /** 完了した伝票の枚数 */
  count: number;
  /** 作業時間（塊ごとの時間の合計 − 昼休憩） */
  workedMin: number;
  /** 件/時（小数1桁）。表示条件を満たさないときは null */
  perHour: number | null;
  /** 表示条件（15件以上かつ30分以上）を満たすか */
  shown: boolean;
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
 * スキャンを**着手時刻の順**に並べ、同じテーブルが連続している範囲（塊）に切る。
 *
 *   同梱 同梱 同梱                 → 同梱の塊が1つ
 *   同梱 同梱 ABCSML 同梱          → 同梱の塊が2つ ＋ ABCSML の塊が1つ
 *
 * 並べ替えを完了時刻にしないのは、保留した伝票の完了が数時間後になり、
 * 実際には連続していた作業が飛び飛びに見えるため（変更要望 2026-10-04 No.2）。
 *
 * 着手〜完了が数時間に及ぶ伝票（保留など）があると、その塊の時間は伸びる。
 * 現場と合意済みの扱い（変更要望 2026-10-10 REQ-2）。
 */
export function blocksOf(records: ScanRecord[]): GroupBlock[] {
  const sorted = [...records].sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    const ae = a.endMin ?? Number.MAX_SAFE_INTEGER;
    const be = b.endMin ?? Number.MAX_SAFE_INTEGER;
    if (ae !== be) return ae - be;
    return a.groupId.localeCompare(b.groupId);
  });

  const blocks: GroupBlock[] = [];
  let cur: GroupBlock | null = null;
  for (const r of sorted) {
    if (cur == null || cur.groupId !== r.groupId) {
      cur = { groupId: r.groupId, from: r.startMin, to: null, count: 0 };
      blocks.push(cur);
    }
    if (r.endMin != null && r.endMin >= r.startMin) {
      cur.count++;
      if (cur.to == null || r.endMin > cur.to) cur.to = r.endMin;
    }
  }
  return blocks;
}

/**
 * テーブルごとの作業ペース。**作業時間の長い順**に返す（変更要望 2026-10-10 REQ-1）。
 *
 *   作業時間 ＝ そのテーブルの全ての塊の時間を足した合計 − 昼休憩の控除
 *   件/時     ＝ 件数 ÷ 作業時間 × 60
 *
 * 間に挟んだ別のテーブルの時間は入らない（塊の時間だけを足すため）。
 * 表示条件（15件以上かつ30分以上）を満たさない行は `shown: false` で返す。
 * 呼び出し側はそれを「その他のテーブル」にまとめる。
 */
export function paceByGroup(records: ScanRecord[]): GroupPace[] {
  const gap = lunchGap(records);

  const count = new Map<string, number>();
  const worked = new Map<string, number>();
  for (const b of blocksOf(records)) {
    count.set(b.groupId, (count.get(b.groupId) ?? 0) + b.count);
    if (b.to == null) continue;
    // 昼休憩は塊ごとに控除する（休憩をまたぐ塊だけが引かれる）
    const breakMin = gap ? overlapMin(b.from, b.to, gap.from, gap.to) : 0;
    worked.set(b.groupId, (worked.get(b.groupId) ?? 0) + Math.max(0, b.to - b.from - breakMin));
  }

  const out: GroupPace[] = [];
  for (const [groupId, n] of count) {
    const workedMin = worked.get(groupId) ?? 0;
    const shown = n >= MIN_COUNT && workedMin >= MIN_WORKED_MIN;
    out.push({
      groupId,
      count: n,
      workedMin,
      perHour: shown ? perHourRate(n, workedMin) : null,
      shown,
    });
  }

  return out.sort((a, b) => b.workedMin - a.workedMin || a.groupId.localeCompare(b.groupId));
}
