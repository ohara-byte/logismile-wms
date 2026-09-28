/**
 * 現場端末（タブレット・ハンディ）向けの進捗集計。
 *
 * 出典：要望書「LogiSmile現場向け進捗表示機能の追加」（久保様 2026-09-27）要望①②③
 *
 *   > 他のテーブルの進捗がわからないため全体の状況を把握できず、
 *   > 今の出荷状況を正しく判断できない
 *   > 配送業者から「この便の荷物はもう集荷できるか」と聞かれた際、
 *   > 各テーブルを歩いて確認する必要がある
 *   > 自分の作業ペースが今どの水準にあるか、本人が把握できない
 *
 * 管理PCの進捗（progress.ts）とは別物として軽く作る。端末は数秒おきに
 * 引くので、終了予測・段階目標といった重い計算は載せない。
 *
 * ★ グループ判定は group-map.ts を共有する（画面ごとに食い違わせない）。
 */

import { prisma } from '../db';
import { UNCLASSIFIED, buildLetterToGroup, groupOfPkNo } from './group-map';
import {
  paceBadge,
  paceBadgeText,
  perHourRate,
  isRevisitPattern,
  type PaceBadge,
} from './work-pace';
import { assignedMinutesByStaff, hhmmToMinutes, type AssignmentBar } from '../assigned-hours';
import { formatDateYmd, jstYmd } from '../date-utils';

/** 配送業者ごとの残件（テーブルごとに出す。出荷全体の合計ではない）。 */
export interface CarrierRemaining {
  carrierCode: string;
  carrierName: string;
  /** 略称（画面が狭いハンディ用） */
  short: string | null;
  remaining: number;
}

export interface FieldGroupProgress {
  groupId: string;
  groupName: string;
  plan: number;
  done: number;
  remaining: number;
  /** 0-100 */
  rate: number;
  /** このグループの配送業者別 残件（残 0 の業者は載せない） */
  carriers: CarrierRemaining[];
}

export interface FieldMeProgress {
  /** 直近のスキャン実績から決めた「自分のテーブル」。決まらなければ null */
  groupId: string | null;
  groupName: string | null;
  /** 本日の処理件数（**伝票枚数**。商品点数ではない） */
  count: number;
  /** 実働分（メンバー割当ガントの配置時間。休憩は配置の隙間になる） */
  workedMin: number;
  /** 件/時。配置が未登録なら null（「0 件/時」と区別する） */
  perHour: number | null;
  badge: PaceBadge | null;
  /** 「🟡 標準ペース（20〜24）」。バッジが無ければ null */
  badgeText: string | null;
  /** 目標（🟡 の下限）。未設定なら null */
  targetYellowMin: number | null;
  /**
   * 同じグループに1日で2回以上戻る「行き来」パターン。
   * 要望書の受け入れ基準により、この日のこのグループは集計対象外として扱う。
   */
  revisit: boolean;
}

export interface FieldProgress {
  /** YYYY-MM-DD */
  date: string;
  overall: { total: number; done: number; remaining: number; rate: number };
  groups: FieldGroupProgress[];
  me: FieldMeProgress;
}

/** 進捗の「完了」= packed / shipped（管理PCの集計と揃える）。 */
const DONE_STATUS = ['packed', 'shipped'];

/**
 * 「自分のテーブル」を直近のスキャン実績から決める。
 *
 * ★ 要望書の指示：
 *   > 遊撃タブレット（TBL-07等）やハンディ（台数・使用テーブルが固定されていない端末）では
 *   > 固定マッピングに頼れないため、直近にスキャンしたPKNOから動的に判定する必要がある
 *   > （固定端末も含めて全端末を動的判定で統一する実装でも構いません）
 *
 *   → **全端末を動的判定で統一**する。固定端末も応援で他テーブルに入ることがあり、
 *     そのとき固定マッピングだと他人のテーブルの進捗を「自分の」と見せてしまう。
 *
 * 判定は「その担当者が**今日**最後に検品した伝票」。
 * 今日まだ1件も検品していなければ、端末の配置（`Device.location`）で補う。
 */
export async function resolveMyGroupId(params: {
  date: Date;
  staffCode: string | null;
  deviceCode: string | null;
  letterToGroup: Map<string, string>;
}): Promise<string | null> {
  const { date, staffCode, deviceCode, letterToGroup } = params;

  if (staffCode) {
    const last = await prisma.inspSession.findFirst({
      where: { staffCode, startedAt: { gte: startOfDay(date), lte: endOfDay(date) } },
      orderBy: { startedAt: 'desc' },
      select: { order: { select: { pkNo: true } } },
    });
    if (last?.order?.pkNo) {
      const gid = groupOfPkNo(letterToGroup, last.order.pkNo);
      if (gid !== UNCLASSIFIED) return gid;
    }
  }

  // まだ今日1件も読んでいない端末（朝いちの待受け画面）。
  //   端末の配置が登録されていればそれを使う。遊撃端末は未設定なので null になる。
  if (deviceCode) {
    const dev = await prisma.device.findUnique({
      where: { code: deviceCode },
      select: { location: true },
    });
    const letter = (dev?.location ?? '').trim().toUpperCase();
    if (letter) {
      const gid = letterToGroup.get(letter);
      if (gid) return gid;
    }
  }
  return null;
}

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

/**
 * 現場端末の進捗を1回で返す。
 *
 * @param staffCode  ログインしている担当者（自分の件数・ペースに使う）
 * @param deviceCode 端末（自分のテーブルの補助判定に使う）
 */
export async function getFieldProgress(params: {
  date: Date;
  staffCode: string | null;
  deviceCode: string | null;
}): Promise<FieldProgress> {
  const { date, staffCode, deviceCode } = params;
  const ymd = formatDateYmd(date);

  const groups = await prisma.inspectionGroup.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      tables: true,
      paceYellowMin: true,
      paceGreenMin: true,
    },
  });
  const letterToGroup = buildLetterToGroup(groups);

  // 当日の伝票。削除済みは数えない（管理PCの集計と揃える）
  const orders = await prisma.shippingOrder.findMany({
    where: { shipDate: new Date(`${ymd}T00:00:00.000Z`), deletedAt: null },
    select: { pkNo: true, status: true, carrierCode: true },
  });

  const carriers = await prisma.carrier.findMany({
    select: { code: true, name: true, short: true, priority: true },
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
  });
  type Bucket = { plan: number; done: number; remainingByCarrier: Map<string, number> };
  const byGroup = new Map<string, Bucket>();
  const bucketOf = (gid: string): Bucket => {
    let b = byGroup.get(gid);
    if (!b) {
      b = { plan: 0, done: 0, remainingByCarrier: new Map() };
      byGroup.set(gid, b);
    }
    return b;
  };

  let total = 0;
  let done = 0;
  for (const o of orders) {
    total++;
    const gid = groupOfPkNo(letterToGroup, o.pkNo);
    const b = bucketOf(gid);
    b.plan++;
    if (DONE_STATUS.includes(o.status)) {
      done++;
      b.done++;
    } else {
      // 残件は配送業者ごとに数える（集荷が迫ったとき「どの便があと何件か」を見るため）
      b.remainingByCarrier.set(o.carrierCode, (b.remainingByCarrier.get(o.carrierCode) ?? 0) + 1);
    }
  }

  const groupProgresses: FieldGroupProgress[] = groups.map((g) => {
    const b = byGroup.get(g.id) ?? { plan: 0, done: 0, remainingByCarrier: new Map() };
    const remaining = Math.max(0, b.plan - b.done);
    return {
      groupId: g.id,
      groupName: g.name,
      plan: b.plan,
      done: b.done,
      remaining,
      rate: b.plan > 0 ? Math.round((b.done / b.plan) * 100) : 0,
      carriers: carriers
        .map((c) => ({
          carrierCode: c.code,
          carrierName: c.name,
          short: c.short,
          remaining: b.remainingByCarrier.get(c.code) ?? 0,
        }))
        .filter((c) => c.remaining > 0),
    };
  });

  const me = await buildMe({ date, staffCode, deviceCode, letterToGroup, groups });

  return {
    date: ymd,
    overall: {
      total,
      done,
      remaining: Math.max(0, total - done),
      rate: total > 0 ? Math.round((done / total) * 100) : 0,
    },
    groups: groupProgresses,
    me,
  };
}

async function buildMe(params: {
  date: Date;
  staffCode: string | null;
  deviceCode: string | null;
  letterToGroup: Map<string, string>;
  groups: Array<{ id: string; name: string; paceYellowMin: number | null; paceGreenMin: number | null }>;
}): Promise<FieldMeProgress> {
  const { date, staffCode, deviceCode, letterToGroup, groups } = params;

  const groupId = await resolveMyGroupId({ date, staffCode, deviceCode, letterToGroup });
  const group = groupId ? groups.find((g) => g.id === groupId) : undefined;

  const empty: FieldMeProgress = {
    groupId: groupId ?? null,
    groupName: group?.name ?? null,
    count: 0,
    workedMin: 0,
    perHour: null,
    badge: null,
    badgeText: null,
    targetYellowMin: group?.paceYellowMin ?? null,
    revisit: false,
  };
  if (!staffCode) return empty;

  // 本日の処理件数 ＝ 完了した検品セッションの数（**伝票枚数**。商品点数ではない）
  const sessions = await prisma.inspSession.findMany({
    where: { staffCode, completedAt: { gte: startOfDay(date), lte: endOfDay(date) } },
    select: { completedAt: true },
  });
  const count = sessions.filter((s) => s.completedAt && jstYmd(s.completedAt) === formatDateYmd(date))
    .length;

  // 実働分 ＝ メンバー割当ガントの配置時間（休憩は配置の隙間になる）
  const assignments = await prisma.memberAssignment.findMany({
    where: { staffCode, date: new Date(`${formatDateYmd(date)}T00:00:00.000Z`) },
    select: { date: true, staffCode: true, groupId: true, startTime: true, endTime: true },
  });
  const bars: AssignmentBar[] = assignments.map((a) => ({
    dateKey: formatDateYmd(a.date),
    staffCode: a.staffCode,
    groupId: a.groupId,
    startTime: a.startTime,
    endTime: a.endTime,
  }));
  const workedMin = assignedMinutesByStaff(bars).get(staffCode) ?? 0;

  // 「行き来」判定：自分のグループへの配置が1日で2つ以上のまとまりに分かれているか
  const revisit = groupId
    ? isRevisitPattern(
        bars
          .filter((b) => b.groupId === groupId)
          .map((b) => ({
            start: hhmmToMinutes(b.startTime) ?? 0,
            end: hhmmToMinutes(b.endTime) ?? 0,
          })),
      )
    : false;

  const rate = perHourRate(count, workedMin);
  const target = {
    yellowMin: group?.paceYellowMin ?? null,
    greenMin: group?.paceGreenMin ?? null,
  };
  // 行き来の日はペースを出さない（要望書の受け入れ基準）
  const badge = revisit ? null : paceBadge(rate, target);

  return {
    groupId: groupId ?? null,
    groupName: group?.name ?? null,
    count,
    workedMin,
    perHour: revisit ? null : rate,
    badge,
    badgeText: badge ? paceBadgeText(badge, target) : null,
    targetYellowMin: target.yellowMin,
    revisit,
  };
}
