/**
 * 進捗集計ロジック（Phase 5-1, 5-2, 5-3, 5-4）
 *
 * 入力日付の出荷指示について以下を集計:
 *  - 全体: 件数, 完了, 残, 完了率, 平均梱包時間, 強制OK 件数
 *  - グループ別: グループ単位でも同じ集計
 *  - 終了予定時刻: 配置メンバー × スキル係数 × 残件 × 標準時間
 *  - 段階目標 vs 予測: 1 時間刻みの目標累積 vs 実績
 *  - 遅延警報: 進捗率 -10% 以上 / 直近30分処理不足
 *
 * 業務時間は 9:00-18:00 を仮定（要件定義書に準拠）。
 */

import { prisma } from '../db';

export interface OverallProgress {
  date: string; // YYYY-MM-DD
  total: number;
  packed: number;
  pending: number;
  inspecting: number;
  held: number;
  forceOkCount: number;
  /** 完了率（0-100） */
  completionRate: number;
  /** 直近30分の処理件数（packed への遷移） */
  recentRate: number;
  /** 平均梱包時間（秒、packed 済みのみ） */
  avgDurationSec: number | null;
}

export interface GroupProgress {
  groupId: string;
  groupName: string;
  /** グループに割り当てられた現在のメンバー数 */
  assignedStaff: number;
  /** 1 時間あたりの標準処理件数（合計）= 60 / std_min */
  hourlyCapacity: number;
  remaining: number;
  /** 終了予定時刻（HH:MM）。算出不能時は null。 */
  etaTime: string | null;
  /** 遅延フラグ（残件 > capacity * 残時間 を超える場合） */
  delayFlag: boolean;
}

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** 当日の全体進捗を集計 */
export async function getOverallProgress(date: Date): Promise<OverallProgress> {
  const from = startOfDay(date);
  const to = endOfDay(date);

  const orders = await prisma.shippingOrder.findMany({
    where: { shipDate: { gte: from, lte: to }, deletedAt: null },
    select: { id: true, status: true },
  });

  const total = orders.length;
  const packed = orders.filter((o) => o.status === 'packed' || o.status === 'shipped').length;
  const pending = orders.filter((o) => o.status === 'pending').length;
  const inspecting = orders.filter((o) => o.status === 'inspecting').length;
  const held = orders.filter((o) => o.status === 'held').length;

  const forceOkCount = await prisma.shippingOrderItem.count({
    where: { forceOk: true, order: { shipDate: { gte: from, lte: to }, deletedAt: null } },
  });

  // 直近 30 分の packed 遷移数（insp_sessions.completed_at から推定）
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const recentRate = await prisma.inspSession.count({
    where: {
      completedAt: { gte: thirtyMinAgo },
      order: { shipDate: { gte: from, lte: to } },
    },
  });

  const completedSessions = await prisma.inspSession.findMany({
    where: {
      completedAt: { not: null },
      durationSec: { not: null },
      order: { shipDate: { gte: from, lte: to } },
    },
    select: { durationSec: true },
  });
  const avgDurationSec =
    completedSessions.length > 0
      ? Math.round(
          completedSessions.reduce((s, c) => s + (c.durationSec ?? 0), 0) /
            completedSessions.length,
        )
      : null;

  return {
    date: from.toISOString().slice(0, 10),
    total,
    packed,
    pending,
    inspecting,
    held,
    forceOkCount,
    completionRate: total > 0 ? Math.round((packed / total) * 100) : 0,
    recentRate,
    avgDurationSec,
  };
}

/** グループ別進捗 + 終了予定時刻 + 遅延フラグ */
export async function getGroupProgresses(date: Date): Promise<GroupProgress[]> {
  const from = startOfDay(date);
  const to = endOfDay(date);

  const groups = await prisma.inspectionGroup.findMany({
    select: {
      id: true,
      name: true,
      stdTimes: { select: { stdMin: true } },
    },
  });

  const assignments = await prisma.memberAssignment.groupBy({
    by: ['groupId'],
    where: { date: from },
    _count: true,
  });
  const assignedMap = new Map(assignments.map((a) => [a.groupId, a._count]));

  // グループ単位の残件は ItemSortOrder ではなく order の status からは取れないので、
  // 仮に「全件を均等配分する」モデル（テーブル割当機能は未着手）。
  const allOrders = await prisma.shippingOrder.count({
    where: { shipDate: { gte: from, lte: to }, status: { in: ['pending', 'inspecting', 'held'] }, deletedAt: null },
  });

  const result: GroupProgress[] = groups.map((g) => {
    const assignedStaff = assignedMap.get(g.id) ?? 0;
    // 標準時間: グループ内の std_min 平均（なければ 2.0）
    const stdMin =
      g.stdTimes.length > 0
        ? g.stdTimes.reduce((s, st) => s + Number(st.stdMin), 0) / g.stdTimes.length
        : 2.0;
    const hourlyCapacityPerStaff = stdMin > 0 ? 60 / stdMin : 0;
    const hourlyCapacity = Math.round(assignedStaff * hourlyCapacityPerStaff);
    // 残件: 全グループ均等配分（テーブル別割当未実装）
    const remaining = Math.ceil(allOrders / Math.max(groups.length, 1));

    // 残作業時間 = 残件 / 時間あたり処理件数
    let etaTime: string | null = null;
    let delayFlag = false;
    if (hourlyCapacity > 0 && remaining > 0) {
      const remainingHours = remaining / hourlyCapacity;
      const now = new Date();
      const etaMs = now.getTime() + remainingHours * 60 * 60 * 1000;
      const eta = new Date(etaMs);
      etaTime = `${String(eta.getHours()).padStart(2, '0')}:${String(eta.getMinutes()).padStart(2, '0')}`;
      // 遅延判定: 業務終了時刻 18:00 を超える場合
      const endOfWork = new Date(now);
      endOfWork.setHours(WORK_END_HOUR, 0, 0, 0);
      delayFlag = etaMs > endOfWork.getTime();
    }

    return {
      groupId: g.id,
      groupName: g.name,
      assignedStaff,
      hourlyCapacity,
      remaining,
      etaTime,
      delayFlag,
    };
  });

  return result;
}

/** 段階目標 vs 予測（1 時間刻み） */
export interface HourlyProgressPoint {
  hour: number; // 9..18
  target: number; // 累積目標
  actual: number; // 累積実績
}

export async function getHourlyProgress(date: Date, total: number, packed: number): Promise<HourlyProgressPoint[]> {
  const from = startOfDay(date);
  const points: HourlyProgressPoint[] = [];
  const hours = WORK_END_HOUR - WORK_START_HOUR;

  // 完了セッション（完了時刻ベース）
  const sessions = await prisma.inspSession.findMany({
    where: {
      completedAt: { not: null },
      order: { shipDate: { gte: from, lte: endOfDay(date) } },
    },
    select: { completedAt: true },
  });

  const actualByHour = new Map<number, number>();
  for (const s of sessions) {
    const h = s.completedAt!.getHours();
    actualByHour.set(h, (actualByHour.get(h) ?? 0) + 1);
  }

  let cumActual = 0;
  for (let i = 0; i <= hours; i++) {
    const hour = WORK_START_HOUR + i;
    const targetCum = Math.round((total * i) / hours);
    cumActual += actualByHour.get(hour - 1) ?? 0; // 当該時刻 (hour) までに完了した数
    points.push({ hour, target: targetCum, actual: Math.min(cumActual, packed) });
  }
  return points;
}
