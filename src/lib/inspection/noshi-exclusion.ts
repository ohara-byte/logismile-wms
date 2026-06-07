/**
 * のし確認 除外判定（2026-06-02 / 2026-06-03 修正）
 *
 * 伝票の **熨斗名称（noshiName）** が NoshiExclusion マスタの matchText と
 * 「完全一致」する場合、検品時の のし☑ 確認をスルーする（のし対象外）。
 *
 * ※ 2026-06-03 現場要望：照合対象は熨斗名称のみ（熨斗氏名は対象外に戻す）。
 *   のし☑トリガーは従来から noshiName のみのため整合する。
 *
 * 検品ページ（server component）で評価し、結果を画面へ渡す。
 */

import { prisma } from '@/lib/db';

/**
 * 熨斗名称が、有効な除外マスタと完全一致するか。空なら false。
 */
export async function isNoshiExcluded(
  noshiName: string | null | undefined,
): Promise<boolean> {
  const n = (noshiName ?? '').trim();
  if (!n) return false;

  const hit = await prisma.noshiExclusion.findFirst({
    where: { active: true, matchText: n },
    select: { id: true },
  });
  return hit !== null;
}
