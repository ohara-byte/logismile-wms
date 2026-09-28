/**
 * 作業ペース（件/時）とバッジ判定の純ロジック。
 *
 * 出典：要望書「LogiSmile現場向け進捗表示機能の追加」（久保様 2026-09-27）要望③
 *
 *   > 件/時 ＝ 処理伝票枚数 ÷ 実働時間（休憩を除いた実勤務時間で算出）。
 *   > 「件」は伝票枚数であり、商品点数ではない点に注意。
 *   > （例：32件 ÷ 実働85分（休憩を除く）× 60 ＝ 22.6件/時）
 *
 * ★ **現場の自己確認用であり、評価目的ではない**（要望書に明記）。
 *   画面の文言もその前提で書くこと。
 *
 * ★ 実働時間は **メンバー割当ガントの配置時間**（MHT）を使う（小原様確定 2026-09-28）。
 *   休憩は配置バーの隙間になるため「休憩を除いた実勤務時間」と一致する。
 *   配置が未登録の日はペースを出さない（0 件/時ではなく「—」）。
 *
 * ★ 目標値はグループマスタ（`InspectionGroup.paceYellowMin` / `paceGreenMin`）。
 *   コードに固定しない（要望書の指示）。未設定ならバッジを出さない。
 *
 * DB へは触らない純関数だけを置く。
 */

export type PaceBadge = 'red' | 'yellow' | 'green';

export const PACE_BADGE_LABEL: Record<PaceBadge, string> = {
  red: '要注意',
  yellow: '標準ペース',
  green: '好調',
};

export const PACE_BADGE_EMOJI: Record<PaceBadge, string> = {
  red: '🔴',
  yellow: '🟡',
  green: '🟢',
};

/** グループ別の目標値。どちらか欠けていれば判定しない。 */
export interface PaceTarget {
  /** 🔴 と 🟡 の境界。この値**以上**なら 🟡 */
  yellowMin: number | null;
  /** 🟡 と 🟢 の境界。この値**以上**なら 🟢 */
  greenMin: number | null;
}

/**
 * 件/時。
 *
 * @param count     処理した**伝票枚数**（商品点数ではない）
 * @param workedMin 実働分（休憩を除く＝配置時間）
 * @returns 小数1桁。実働が 0 以下なら **null**（「0 件/時」と区別する）
 */
export function perHourRate(count: number, workedMin: number): number | null {
  if (!(workedMin > 0)) return null;
  const v = (count / workedMin) * 60;
  return Math.round(v * 10) / 10;
}

/**
 * バッジ判定。
 *
 * 境界は**その値を含めて上の段**（要望書の表記「45〜70」＝ 45 以上 70 未満が 🟡）。
 * 目標値が未設定のグループは null（バッジを出さない）。
 */
export function paceBadge(rate: number | null, target: PaceTarget): PaceBadge | null {
  if (rate == null) return null;
  const { yellowMin, greenMin } = target;
  if (yellowMin == null || greenMin == null) return null;
  if (rate >= greenMin) return 'green';
  if (rate >= yellowMin) return 'yellow';
  return 'red';
}

/**
 * バッジの説明文。「🟡 標準ペース（20〜24）」のように範囲を添える。
 * 現場が「あと何件で上の段か」を自分で判断できるようにするため。
 */
export function paceBadgeText(badge: PaceBadge, target: PaceTarget): string {
  const emoji = PACE_BADGE_EMOJI[badge];
  const label = PACE_BADGE_LABEL[badge];
  const { yellowMin, greenMin } = target;
  if (yellowMin == null || greenMin == null) return `${emoji} ${label}`;
  const range =
    badge === 'red' ? `〜${yellowMin}` : badge === 'yellow' ? `${yellowMin}〜${greenMin}` : `${greenMin}〜`;
  return `${emoji} ${label}（${range}）`;
}

/**
 * 掛け持ちの扱い（要望書 受け入れ基準）。
 *
 *   > 掛け持ち（大半は2テーブルを跨ぐ勤務）は、同じグループへの滞在が1日の中で
 *   > 1つのまとまり（ブロック）であれば通常通り集計される（午前A・午後Bのような
 *   > 一般的な2テーブル勤務も対象）。同じグループに1日で2回以上戻る「行き来」
 *   > パターンの場合のみ、その日のそのグループの数値は集計対象外となる。
 *
 * 配置バー（同じ日・同じ担当者・同じグループ）が**時間的に離れて2本以上**あれば
 * 「行き来」とみなす。隣接・重なりは1つのまとまりとして数える。
 *
 * @param spans 同一グループの配置区間（分）。順不同でよい
 * @returns まとまりの数。2 以上なら集計対象外
 */
export function visitBlockCount(spans: Array<{ start: number; end: number }>): number {
  const valid = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  let blocks = 0;
  let curEnd = -1;
  for (const s of valid) {
    if (curEnd < 0 || s.start > curEnd) {
      blocks++;
      curEnd = s.end;
    } else if (s.end > curEnd) {
      curEnd = s.end;
    }
  }
  return blocks;
}

/** 行き来（同じグループに1日で2回以上戻る）か。 */
export function isRevisitPattern(spans: Array<{ start: number; end: number }>): boolean {
  return visitBlockCount(spans) >= 2;
}
