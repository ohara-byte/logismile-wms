/**
 * 管理 PC ナビバッジの集計
 *
 * モック準拠（管理用PCモック_v0.22.html L2453-2462）:
 *   alerts: 未解決アラート件数
 *   force : 強制OK 未承認件数（A-05）
 *   ann   : 着信 (inbox) の未読件数（A-06）
 *   link  : 基幹連携 未マップ件数（A-11 で本実装。現状 0）
 *   match : 未検品照合 未処理件数（A-12 で本実装。現状 0）
 *
 * SSE と REST 双方から呼ばれる純粋関数。短時間に高頻度コールされるため
 * クエリは軽量に保つ。
 */

import { prisma } from '@/lib/db';
import { type BadgeCounts } from './badges-types';

export { type BadgeCounts, ZERO_BADGES, badgesEqual } from './badges-types';

export async function getBadgeCounts(): Promise<BadgeCounts> {
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

    // ann: 着信 (inbox) の未読件数（A-06）
    //   モック準拠: 現場（タブレット/ハンディ）からの本部連絡のうち
    //   readAt = null のもの
    prisma.notice.count({
      where: {
        kind: 'inbox',
        active: true,
        readAt: null,
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

