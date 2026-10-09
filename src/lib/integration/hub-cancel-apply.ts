/**
 * HUB 当日キャンセルを DB に書く（2026-10-09）。判断と文面は hub-cancel.ts（テストで固定）。
 *
 * 検品の完了と同時に来たときに食い違わないよう、どちらも条件つきで書く:
 *   - ここ:       「梱包済・出荷済でなく、まだ印が無い」ときだけ印を付ける
 *   - 検品の完了: 「印が無い」ときだけ梱包済にする（inspect/complete）
 * 先に書けた方が勝ち、負けた方は読み直して結果を決める。
 */

import { prisma } from '../db';
import { todayJstAsUTC } from '../date-utils';
import { HUB_STAFF_CODE } from './hub-handler';
import { decideHubCancel, hubCancelNotice, type HubCancelInput, type HubCancelOutcome } from './hub-cancel';

const orderSelect = {
  id: true, pkNo: true, status: true, invoiceNo: true, destName: true, deletedAt: true, cancelRequestedAt: true,
  inspSession: { select: { staffCode: true, deviceCode: true, completedAt: true, staff: { select: { name: true } } } },
} as const;

export async function applyHubCancel(input: HubCancelInput): Promise<HubCancelOutcome> {
  const order = await prisma.shippingOrder.findFirst({ where: { pkNo: input.pkNo }, select: orderSelect });
  if (!order) {
    return { result: 'not_found', previousStatus: null, destName: null, invoiceNo: null, packedAt: null, inspector: null, noticeId: null };
  }
  const base = { previousStatus: order.status, destName: order.destName, invoiceNo: order.invoiceNo };
  if (order.cancelRequestedAt) {
    return { result: 'already_cancelled', ...base, packedAt: null, inspector: null, noticeId: null };
  }

  const now = new Date();
  const reason = input.reason;
  const cancelData = { cancelRequestedAt: now, cancelReason: reason, cancelBy: input.operator ?? null };

  return prisma.$transaction(async (tx) => {
    let decision = decideHubCancel(order.status);
    if (decision !== 'packed') {
      // 梱包済・出荷済でなく、まだ印が無いときだけ（検品の完了と同時なら、先に梱包済になった方が勝つ）
      const marked = await tx.shippingOrder.updateMany({
        where: { id: order.id, cancelRequestedAt: null, status: { notIn: ['packed', 'shipped'] } },
        data: {
          ...cancelData,
          // 未着手・保留はあわせて論理削除（一覧・進捗から外す）。既に削除済みならそのまま
          ...(decision === 'cancelled' && !order.deletedAt
            ? { deletedAt: now, deletedBy: HUB_STAFF_CODE, deleteReason: `HUB 当日キャンセル: ${reason}` }
            : {}),
        },
      });
      if (marked.count === 0) decision = 'packed';
    }
    if (decision === 'packed') {
      // 止めない。キャンセルを受けた記録だけ残す
      await tx.shippingOrder.updateMany({ where: { id: order.id, cancelRequestedAt: null }, data: cancelData });
    }

    await tx.orderAuditLog.create({
      data: {
        orderId: order.id,
        pkNo: order.pkNo,
        action: 'hub_cancel',
        actedBy: HUB_STAFF_CODE,
        reason: input.operator ? `${reason}（callHUB: ${input.operator}）` : reason,
        diff: { before: { status: order.status, deletedAt: order.deletedAt }, after: { cancel: decision } },
      },
    });

    const n = hubCancelNotice({ pkNo: order.pkNo, invoiceNo: order.invoiceNo, destName: order.destName, reason, result: decision });
    const notice = await tx.notice.create({
      data: {
        date: todayJstAsUTC(),
        kind: 'announce',
        title: n.title,
        body: n.body,
        targetType: n.targetType,
        ackRequired: n.ackRequired,
        senderCode: n.senderCode,
        priority: n.priority,
      },
      select: { id: true },
    });

    const s = order.inspSession;
    return {
      result: decision,
      ...base,
      packedAt: decision === 'packed' && s?.completedAt ? s.completedAt.toISOString() : null,
      inspector: decision === 'blocked_inspecting' && s
        ? { staffCode: s.staffCode, staffName: s.staff?.name ?? null, deviceCode: s.deviceCode }
        : null,
      noticeId: notice.id,
    };
  });
}
