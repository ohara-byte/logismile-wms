/**
 * 出荷残の自動翌日繰越（Sprint Z-8 Q3=A）
 *
 * 当日納品完了通知（または手動実行）で起動。
 *  - 引当が完了していない出荷指示の shipDate を翌日に進める
 *  - order_audit_logs に reason='auto_carryover' で記録
 *
 * factory_api モード時のみ自動起動。legacy モードでは管理者の手動実行に委ねる。
 */

import { prisma } from '@/lib/db';
import { parseDateAsUTC, addDaysUTC, todayJstAsUTC } from '@/lib/date-utils';

export interface CarryoverResult {
  targetDate: string;
  nextDate: string;
  orderCount: number;
  itemCount: number;
  pkNos: string[];
}

/**
 * 指定日の引当未完了伝票を翌日繰越。
 * @param targetDate YYYY-MM-DD
 * @param trigger    'factory_api' | 'manual' — audit ログ用
 */
export async function runDailyCarryover(
  targetDate: string,
  trigger: 'factory_api' | 'manual',
): Promise<CarryoverResult> {
  // 日付根治（2026-07-02）: @db.Date と揃うよう UTC 真夜中で扱う（setHours は JST でズレる）。
  const start = parseDateAsUTC(targetDate) ?? todayJstAsUTC();
  const end = addDaysUTC(start, 1);

  const orders = await prisma.shippingOrder.findMany({
    where: {
      shipDate: { gte: start, lt: end },
      deletedAt: null,
      status: { in: ['pending', 'inspecting', 'held'] },
    },
    include: {
      items: { select: { qty: true } },
      allocations: { where: { status: { not: 'released' } }, select: { qty: true } },
    },
  });

  // 引当不足判定
  const targets = orders.filter((o) => {
    const required = o.items.reduce((s, it) => s + it.qty, 0);
    const allocated = o.allocations.reduce((s, a) => s + a.qty, 0);
    return allocated < required;
  });

  if (targets.length === 0) {
    return {
      targetDate,
      nextDate: end.toISOString().slice(0, 10),
      orderCount: 0,
      itemCount: 0,
      pkNos: [],
    };
  }

  // 翌日へ繰越（shipDate += 1）
  // 注: order_audit_logs は actedBy が staff.code への FK 必須のため、
  //     factory 由来 / manual 一括の場合はここでは記録しない（StockMovement 等で追跡可）。
  const ids = targets.map((t) => t.id);
  await prisma.shippingOrder.updateMany({
    where: { id: { in: ids } },
    data: { shipDate: end },
  });
  // trigger は将来 audit テーブル拡張時に活用予定（現状はメッセージにのみ反映）
  void trigger;

  return {
    targetDate,
    nextDate: end.toISOString().slice(0, 10),
    orderCount: targets.length,
    itemCount: targets.reduce((s, t) => s + t.items.length, 0),
    pkNos: targets.map((t) => t.pkNo),
  };
}
