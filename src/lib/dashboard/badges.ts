/**
 * 管理 PC ナビバッジの集計
 *
 * モック準拠（管理用PCモック_v0.22.html L2453-2462）:
 *   alerts: 未解決アラート件数
 *   force : 強制OK 未承認件数（packed 前で force_ok 付き）
 *   ann   : 当日の有効な連絡事項のうち未読相当（既読管理が無いため
 *           当日 active かつ priority>=50 で代用）
 *   link  : 基幹連携 未マップ件数（A-11 で本実装。現状 0）
 *   match : 未検品照合 未処理件数（A-12 で本実装。現状 0）
 *
 * SSE と REST 双方から呼ばれる純粋関数。短時間に高頻度コールされるため
 * クエリは軽量に保つ。
 */

import { prisma } from '@/lib/db';
import { type BadgeCounts } from './badges-types';

export { type BadgeCounts, ZERO_BADGES, badgesEqual } from './badges-types';

export async function getBadgeCounts(now: Date = new Date()): Promise<BadgeCounts> {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [alerts, forcePending, annUnread] = await Promise.all([
    // alerts: 未解決アラート
    prisma.alert.count({ where: { resolved: false } }),

    // force: 強制OK 未承認件数（A-05）
    //   forceOk=true かつ forceApprovalStatus=null（承認・却下のいずれもされていない）
    //   ただし R01「セット品時間制約」は日常運用のため承認対象から除外
    //   削除済み伝票も対象外
    prisma.shippingOrderItem.count({
      where: {
        forceOk: true,
        forceApprovalStatus: null,
        OR: [
          { forceReasonCode: null },
          { forceReasonCode: { not: 'R01' } },
        ],
        order: { deletedAt: null },
      },
    }),

    // ann: 当日有効・priority>=50 を未読相当として代用
    prisma.notice.count({
      where: {
        active: true,
        date: { gte: today, lt: tomorrow },
        priority: { gte: 50 },
      },
    }),
  ]);

  return {
    alerts,
    force: forcePending,
    ann: annUnread,
    link: 0, // TODO A-11
    match: 0, // TODO A-12
  };
}

