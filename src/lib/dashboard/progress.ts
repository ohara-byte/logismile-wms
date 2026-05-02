/**
 * 進捗集計ロジック（Phase 5 + Phase 7-2 拡張）
 *
 * 入力日付の出荷指示について以下を集計:
 *  - 全体: 件数, 完了, 残, 完了率, 平均梱包時間, 強制OK 件数, ETA予測, 段階目標
 *  - グループ別: 集計 + 終了予定時刻 + 状態 + 配置メンバー名
 *  - 段階目標 vs 予測: 1 時間刻みの目標累積 vs 実績
 *  - 1時間別実績（累積でなく時間単位）
 *  - 遅延警報: 進捗率 -10% 以上 / 直近30分処理不足
 *
 * 業務時間は 9:00-18:00 を仮定（要件定義書に準拠）。
 */

import { prisma } from '../db';

export interface OverallProgress {
  date: string;
  total: number;
  packed: number;
  pending: number;
  inspecting: number;
  held: number;
  forceOkCount: number;
  /** 強制OK のうち未承認件数（Phase 7-2 拡張、現状は forceOkCount と同値） */
  forceOkPending: number;
  /** 強制OK 理由別件数（Phase 7-2 拡張、現状空 obj） */
  forceOkByReason: Record<string, number>;
  /** 完了率（0-100） */
  completionRate: number;
  /** 直近30分の処理件数（packed への遷移） */
  recentRate: number;
  /** 平均梱包時間（秒、packed 済みのみ） */
  avgDurationSec: number | null;
  /** 計画比（0=計画通り、+5=計画より 5%先行、−5=遅れ） */
  planDelta: number;
  /** 完了予測時刻（HH:MM）。直近30分の処理ペースで推定。算出不能時は null。 */
  etaCompletion: string | null;
  /** 完了予測の業務終了 18:00 との差（分）。負=前倒し、正=遅れ。null は算出不能。 */
  etaDeltaMin: number | null;
  /** 段階目標（時刻 → 累積目標件数）。当面は等分配（運用で調整可能なフィールドに育てる） */
  stages: { hour: number; target: number; status: 'done' | 'current' | 'wait' }[];
}

export type GroupStatus = 'working' | 'done' | 'alert' | 'wait';

export interface GroupProgress {
  groupId: string;
  groupName: string;
  /** グループに所属するテーブル群（モック表示用） */
  tables: string[];
  /** グループに割り当てられた現在のメンバー数 */
  assignedStaff: number;
  /** 配置メンバー名（先頭3件） */
  staffNames: string[];
  /** 1 時間あたりの標準処理件数 */
  hourlyCapacity: number;
  /** 完了件数（このグループ持分） */
  done: number;
  /** 計画件数（このグループ持分） */
  plan: number;
  remaining: number;
  /** 進捗率（0-100） */
  progressRate: number;
  /** 状態区分 */
  status: GroupStatus;
  /** 終了予定時刻（HH:MM） */
  etaTime: string | null;
  /** 終了予定時刻の状態区分（締切に対する 4 段階） */
  etaStatus: 'ok' | 'warn' | 'over' | 'done' | null;
  /** 残作業に必要な分（ツールチップ用） */
  etaRemainingMin: number | null;
  /** 標準時間（分/件、ツールチップ用） */
  stdMin: number;
  /** スキル係数の平均（ツールチップ用） */
  skillCoef: number;
  /** 遅延フラグ（後方互換） */
  delayFlag: boolean;
}

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
const GROUP_DEADLINE_HOUR = 17; // 主要運送会社の締切（暫定固定値）

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

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

  // 直近 30 分の packed 遷移数
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

  // 計画比: 業務時間内の経過率と完了率の差
  const completionRate = total > 0 ? Math.round((packed / total) * 100) : 0;
  const now = new Date();
  const elapsedHours = Math.max(
    0,
    Math.min(
      WORK_END_HOUR - WORK_START_HOUR,
      now.getHours() + now.getMinutes() / 60 - WORK_START_HOUR,
    ),
  );
  const expectedRate = Math.round((elapsedHours / (WORK_END_HOUR - WORK_START_HOUR)) * 100);
  const planDelta = completionRate - expectedRate;

  // 完了予測時刻: 直近30分のペース × 残件 / 30分
  const remaining = total - packed;
  let etaCompletion: string | null = null;
  let etaDeltaMin: number | null = null;
  if (remaining > 0 && recentRate > 0) {
    const minutesNeeded = (remaining / recentRate) * 30;
    const eta = new Date(now.getTime() + minutesNeeded * 60 * 1000);
    etaCompletion = fmtTime(eta);
    const endOfWork = new Date(now);
    endOfWork.setHours(WORK_END_HOUR, 0, 0, 0);
    etaDeltaMin = Math.round((eta.getTime() - endOfWork.getTime()) / 60000);
  } else if (remaining === 0 && total > 0) {
    etaCompletion = '完了';
    etaDeltaMin = 0;
  }

  // 段階目標: 9/12/15/16/18 の累積目標を等分配で生成（運用調整可能）
  const stageHours = [9, 12, 15, 16, 18];
  const stages = stageHours.map((hour) => {
    const ratio = (hour - WORK_START_HOUR) / (WORK_END_HOUR - WORK_START_HOUR);
    const target = Math.round(total * ratio);
    let status: 'done' | 'current' | 'wait' = 'wait';
    if (now.getHours() >= hour) status = 'done';
    else if (now.getHours() === hour - 1 || (now.getHours() < hour && now.getHours() >= hour - 3))
      status = 'current';
    return { hour, target, status };
  });

  return {
    date: from.toISOString().slice(0, 10),
    total,
    packed,
    pending,
    inspecting,
    held,
    forceOkCount,
    forceOkPending: forceOkCount, // 承認フローはまだ未実装、現時点で全件を未承認扱い
    forceOkByReason: {},
    completionRate,
    recentRate,
    avgDurationSec,
    planDelta,
    etaCompletion,
    etaDeltaMin,
    stages,
  };
}

/** グループ別進捗 + 終了予定時刻 + 状態 */
export async function getGroupProgresses(date: Date): Promise<GroupProgress[]> {
  const from = startOfDay(date);
  const to = endOfDay(date);

  const groups = await prisma.inspectionGroup.findMany({
    select: {
      id: true,
      name: true,
      tables: true,
      stdTimes: { select: { stdMin: true } },
    },
  });

  // 配置メンバー（assignment）
  const assignments = await prisma.memberAssignment.findMany({
    where: { date: from },
    select: {
      groupId: true,
      staff: { select: { code: true, name: true, skillCoefficient: true } },
    },
  });
  const assignedByGroup = new Map<
    string,
    { count: number; names: string[]; skillCoefSum: number }
  >();
  for (const a of assignments) {
    const cur = assignedByGroup.get(a.groupId) ?? { count: 0, names: [], skillCoefSum: 0 };
    cur.count += 1;
    if (cur.names.length < 3) cur.names.push(a.staff.name);
    cur.skillCoefSum += Number(a.staff.skillCoefficient);
    assignedByGroup.set(a.groupId, cur);
  }

  // 全件をグループ均等配分（暫定）。テーブル別割当は Phase 7-5 で対応。
  const orders = await prisma.shippingOrder.findMany({
    where: { shipDate: { gte: from, lte: to }, deletedAt: null },
    select: { status: true },
  });
  const totalOrders = orders.length;
  const packedOrders = orders.filter((o) => o.status === 'packed' || o.status === 'shipped').length;
  const groupCount = Math.max(groups.length, 1);
  const planPerGroup = Math.ceil(totalOrders / groupCount);
  const donePerGroup = Math.floor(packedOrders / groupCount);

  const now = new Date();

  const result: GroupProgress[] = groups.map((g) => {
    const a = assignedByGroup.get(g.id) ?? { count: 0, names: [], skillCoefSum: 0 };
    const assignedStaff = a.count;
    const skillCoef = assignedStaff > 0 ? a.skillCoefSum / assignedStaff : 1.0;

    const stdMin =
      g.stdTimes.length > 0
        ? g.stdTimes.reduce((s, st) => s + Number(st.stdMin), 0) / g.stdTimes.length
        : 2.0;
    const hourlyCapacityPerStaff = stdMin > 0 ? (60 / stdMin) * skillCoef : 0;
    const hourlyCapacity = Math.round(assignedStaff * hourlyCapacityPerStaff);

    const plan = planPerGroup;
    const done = Math.min(donePerGroup, plan);
    const remaining = Math.max(0, plan - done);
    const progressRate = plan > 0 ? Math.round((done / plan) * 100) : 0;

    let etaTime: string | null = null;
    let etaRemainingMin: number | null = null;
    let etaStatus: GroupProgress['etaStatus'] = null;

    if (remaining === 0) {
      etaStatus = 'done';
    } else if (assignedStaff > 0 && stdMin > 0 && skillCoef > 0) {
      const needMin = Math.ceil((remaining * stdMin) / (assignedStaff * skillCoef));
      etaRemainingMin = needMin;
      const eta = new Date(now.getTime() + needMin * 60 * 1000);
      etaTime = fmtTime(eta);

      const deadline = new Date(now);
      deadline.setHours(GROUP_DEADLINE_HOUR, 0, 0, 0);
      const diffMin = (eta.getTime() - deadline.getTime()) / 60000;
      if (diffMin <= -30) etaStatus = 'ok';
      else if (diffMin <= 0) etaStatus = 'warn';
      else etaStatus = 'over';
    }

    let status: GroupStatus = 'working';
    if (assignedStaff === 0) status = 'wait';
    else if (remaining === 0 && plan > 0) status = 'done';
    else if (etaStatus === 'over') status = 'alert';

    return {
      groupId: g.id,
      groupName: g.name,
      tables: g.tables,
      assignedStaff,
      staffNames: a.names,
      hourlyCapacity,
      done,
      plan,
      remaining,
      progressRate,
      status,
      etaTime,
      etaStatus,
      etaRemainingMin,
      stdMin: Math.round(stdMin * 100) / 100,
      skillCoef: Math.round(skillCoef * 1000) / 1000,
      delayFlag: status === 'alert',
    };
  });

  return result;
}

/** 1時間別 計画 vs 実績（累積ではなく時間単位） */
export interface HourlyPoint {
  hour: number;
  /** その時間帯の計画件数（targetHourly = (total / 業務時間数) で均等配分） */
  planHourly: number;
  /** その時間帯に packed になった件数（insp_session.completed_at の hour） */
  actualHourly: number;
  isCurrent: boolean;
}

export async function getHourlyChart(date: Date): Promise<HourlyPoint[]> {
  const from = startOfDay(date);
  const ordersTotal = await prisma.shippingOrder.count({
    where: { shipDate: { gte: from, lte: endOfDay(date) }, deletedAt: null },
  });
  const totalHours = WORK_END_HOUR - WORK_START_HOUR;
  const planPerHour = Math.round(ordersTotal / Math.max(totalHours, 1));

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

  const nowHour = new Date().getHours();
  const points: HourlyPoint[] = [];
  for (let h = WORK_START_HOUR - 1; h < WORK_END_HOUR; h++) {
    points.push({
      hour: h,
      planHourly: h >= WORK_START_HOUR ? planPerHour : 0,
      actualHourly: actualByHour.get(h) ?? 0,
      isCurrent: h === nowHour,
    });
  }
  return points;
}

/** 段階目標 vs 予測（1 時間刻み、累積）— 後方互換のため残す */
export interface HourlyProgressPoint {
  hour: number;
  target: number;
  actual: number;
}

export async function getHourlyProgress(
  date: Date,
  total: number,
  packed: number,
): Promise<HourlyProgressPoint[]> {
  const from = startOfDay(date);
  const points: HourlyProgressPoint[] = [];
  const hours = WORK_END_HOUR - WORK_START_HOUR;

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
    cumActual += actualByHour.get(hour - 1) ?? 0;
    points.push({ hour, target: targetCum, actual: Math.min(cumActual, packed) });
  }
  return points;
}

/** 30分要員配置グリッド（Phase 7-2 拡張） */
export interface StaffSlotRow {
  category: 'group' | 'line' | 'sort' | 'sas';
  label: string;
  /** 18 スロット × 30 分（9:00-18:00） */
  slots: number[];
}

export async function getStaffAllocationGrid(date: Date): Promise<{
  rows: StaffSlotRow[];
  summary: {
    currentTime: string;
    currentCount: number;
    amPeak: { time: string; count: number };
    pmPeak: { time: string; count: number };
    totalManHours: number;
  };
}> {
  const from = startOfDay(date);
  const groups = await prisma.inspectionGroup.findMany({ select: { id: true, name: true } });
  const assignments = await prisma.memberAssignment.findMany({
    where: { date: from },
    select: { groupId: true, startTime: true, endTime: true },
  });

  const SLOTS = 18; // 9:00 - 18:00 を 30 分刻みで 18 スロット
  function slotIdx(time: string): number {
    const [h, m] = time.split(':').map((s) => parseInt(s, 10));
    return Math.max(0, Math.min(SLOTS - 1, (h - WORK_START_HOUR) * 2 + (m >= 30 ? 1 : 0)));
  }

  const groupSlotMap = new Map<string, number[]>();
  for (const g of groups) groupSlotMap.set(g.id, new Array(SLOTS).fill(0));

  for (const a of assignments) {
    const start = slotIdx(a.startTime);
    const end = slotIdx(a.endTime);
    const arr = groupSlotMap.get(a.groupId);
    if (!arr) continue;
    for (let i = start; i < end; i++) arr[i] += 1;
  }

  const rows: StaffSlotRow[] = groups.map((g) => ({
    category: 'group' as const,
    label: g.name,
    slots: groupSlotMap.get(g.id) ?? new Array(SLOTS).fill(0),
  }));

  // ライン/仕分/SAS は Phase 7-5 でグループ外配置として実装。現状はゼロ行で表示。
  rows.push({ category: 'line', label: 'ライン', slots: new Array(SLOTS).fill(0) });
  rows.push({ category: 'sort', label: '仕分', slots: new Array(SLOTS).fill(0) });
  rows.push({ category: 'sas', label: 'SAS', slots: new Array(SLOTS).fill(0) });

  // サマリ計算
  const now = new Date();
  const currentSlot = (now.getHours() - WORK_START_HOUR) * 2 + (now.getMinutes() >= 30 ? 1 : 0);
  const safeSlot = Math.max(0, Math.min(SLOTS - 1, currentSlot));

  const totalsBySlot = new Array(SLOTS).fill(0);
  for (const r of rows) {
    for (let i = 0; i < SLOTS; i++) totalsBySlot[i] += r.slots[i];
  }
  const currentCount = totalsBySlot[safeSlot];

  // AM/PM ピーク
  const amSlots = totalsBySlot.slice(0, 6); // 9:00 - 12:00
  const pmSlots = totalsBySlot.slice(6); // 12:00 -
  const amPeakIdx = amSlots.length > 0 ? amSlots.indexOf(Math.max(...amSlots)) : 0;
  const pmPeakIdx = pmSlots.length > 0 ? pmSlots.indexOf(Math.max(...pmSlots)) : 0;
  function slotToHHMM(idx: number): string {
    const h = WORK_START_HOUR + Math.floor(idx / 2);
    const m = (idx % 2) * 30;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const totalManHours = totalsBySlot.reduce((s, x) => s + x, 0) * 0.5;

  return {
    rows,
    summary: {
      currentTime: slotToHHMM(safeSlot),
      currentCount,
      amPeak: { time: slotToHHMM(amPeakIdx), count: amSlots[amPeakIdx] ?? 0 },
      pmPeak: { time: slotToHHMM(6 + pmPeakIdx), count: pmSlots[pmPeakIdx] ?? 0 },
      totalManHours,
    },
  };
}
