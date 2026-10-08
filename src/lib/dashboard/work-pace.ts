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
 * ★ 実働時間は **スキャン実績**から出す（変更要望 No.1・久保様 2026-10-04／小原様了承 2026-10-08）。
 *   2026-09-28 にメンバー割当の配置時間（MHT）と決めたが、前裁きなど
 *   スキャン記録の残らない作業や午後の予定まで分母に入り、実際より大幅に低く出た。
 *   計算は `scan-pace.ts` に置く。出せないときは 0 件/時ではなく「—」。
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
 * @param workedMin 実働分（休憩を除く）
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

/* 掛け持ち・行き来（同じグループに1日で2回以上戻る）の判定は、
 * **スキャン実績**をもとにする `scan-pace.ts` の `revisitGroups()` に移した
 * （変更要望 No.2・久保様 2026-10-04）。
 *
 * 以前はメンバー割当の配置バーで数えていたが、昼休憩で配置が2本に分かれるだけで
 * 「行き来」と判定され、昼休憩を取る人のほぼ全員でペースが出なくなっていた。
 */
