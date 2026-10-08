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
 *
 * ★ 2026-10-08 改訂（変更要望3件・久保様 2026-10-04）。
 *   作業ペースの実働時間と「行き来」の判定を、**メンバー割当ではなくスキャン実績**に
 *   改めた（計算は scan-pace.ts）。あわせて、本日スキャンしたテーブルごとのペースを
 *   `me.tables` に載せる（手伝いに入ったテーブルで 🔴 が出る問題への対応）。
 */

import { prisma } from '../db';
import { UNCLASSIFIED, buildLetterToGroup, groupOfPkNo } from './group-map';
import { paceBadge, paceBadgeText, type PaceBadge } from './work-pace';
import { paceByGroup, type PaceSkipReason, type ScanRecord } from './scan-pace';
import { jstDayAndMinute } from '../assigned-hours';
import { formatDateYmd, jstDayStart, jstDayEnd } from '../date-utils';

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

/**
 * 本日スキャンしたテーブル1つぶんの作業ペース（変更要望 No.3・久保様 2026-10-04）。
 *
 *   > 現場では、担当のテーブルが終わったら別のテーブルを手伝う、という動きがある。
 *   > 終業時に自分のペースを確認しようとしても、今の画面では確認できない。
 */
export interface FieldMeTable {
  groupId: string;
  groupName: string;
  /** このテーブルで完了した伝票の枚数 */
  count: number;
  /** 実働分（最初の着手〜最後の完了 − 昼休憩） */
  workedMin: number;
  /** 件/時。出せないときは null */
  perHour: number | null;
  badge: PaceBadge | null;
  badgeText: string | null;
  /** 目標（🟡 の下限）。未設定なら null */
  targetYellowMin: number | null;
  /** 同じグループに1日で2回以上戻る「行き来」か */
  revisit: boolean;
  /** 数字を出せない理由（画面の「—」の説明に使う） */
  reason: PaceSkipReason;
  /** いま作業しているテーブルの行か */
  current: boolean;
}

export interface FieldMeProgress {
  /** 直近のスキャン実績から決めた「自分のテーブル」。決まらなければ null */
  groupId: string | null;
  groupName: string | null;
  /** 本日の処理件数（**伝票枚数**。商品点数ではない。テーブルを問わない合計） */
  count: number;
  /** いま作業しているテーブルの実働分（スキャン実績から。昼休憩は自動控除） */
  workedMin: number;
  /** いま作業しているテーブルの件/時。出せないときは null（「0 件/時」と区別する） */
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
  /** 数字を出せない理由（画面の「—」の説明に使う） */
  reason: PaceSkipReason;
  /** 本日スキャンしたテーブルごとの作業ペース（件数の多い順） */
  tables: FieldMeTable[];
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
 * 判定は「その担当者が**今日**最後に着手した伝票」。
 * 今日まだ1件も検品していなければ、端末の配置（`Device.location`）で補う。
 */
export async function resolveMyGroupId(params: {
  /** その担当者が本日スキャンした伝票（未分類は除いてある） */
  records: ScanRecord[];
  deviceCode: string | null;
  letterToGroup: Map<string, string>;
}): Promise<string | null> {
  const { records, deviceCode, letterToGroup } = params;

  let last: ScanRecord | null = null;
  for (const r of records) if (last == null || r.startMin >= last.startMin) last = r;
  if (last) return last.groupId;

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

  const dayFrom = jstDayStart(date);
  const dayTo = jstDayEnd(date);
  const inDay = (d: Date | null | undefined): d is Date =>
    d != null && d >= dayFrom && d <= dayTo;

  /*
   * 本日の検品セッション。
   * 「本日の処理件数」「作業ペース」「行き来の判定」「自分のテーブル」を
   * この1回で賄う（端末は数秒おきに引くので、問い合わせを増やさない）。
   *
   * 着手と完了のどちらかが本日に入っていれば拾う。日またぎは本来起きないが、
   * 保留した伝票が翌朝に完了することはありうるため、取りこぼさないようにする。
   */
  const sessions = staffCode
    ? await prisma.inspSession.findMany({
        where: {
          staffCode,
          OR: [
            { startedAt: { gte: dayFrom, lte: dayTo } },
            { completedAt: { gte: dayFrom, lte: dayTo } },
          ],
        },
        orderBy: { startedAt: 'asc' },
        select: { startedAt: true, completedAt: true, order: { select: { pkNo: true } } },
      })
    : [];

  // ① 本日の処理件数 ＝ 本日完了した伝票（**伝票枚数**。商品点数ではない）。
  //    テーブルを問わない1日の合計。テーブルごとの件数は `tables` に入れる。
  const count = sessions.filter((s) => inDay(s.completedAt)).length;

  /*
   * 作業ペースと行き来の判定に使うスキャン実績（変更要望 No.1 / No.2・久保様 2026-10-04）。
   *
   * ★ 2026-09-28 までは分母に**メンバー割当の配置時間**を使っていたが、
   *   前裁きなど「スキャン記録の残らない作業」や午後の予定まで分母に入り、
   *   実際より大幅に低い値が出ていた。スキャン実績に改める。
   *
   * 本日着手した伝票だけを対象にする。テーブルが決まらない伝票（未分類）は、
   * どのグループのペースにも足せないため除く。
   */
  const records: ScanRecord[] = [];
  for (const s of sessions) {
    if (!inDay(s.startedAt)) continue;
    const gid = groupOfPkNo(letterToGroup, s.order.pkNo);
    if (gid === UNCLASSIFIED) continue;
    records.push({
      groupId: gid,
      startMin: jstDayAndMinute(s.startedAt).minute,
      endMin: inDay(s.completedAt) ? jstDayAndMinute(s.completedAt).minute : null,
    });
  }

  const groupId = await resolveMyGroupId({ records, deviceCode, letterToGroup });
  const group = groupId ? groups.find((g) => g.id === groupId) : undefined;

  // テーブルごとの作業ペース（件数の多い順）。
  const byId = new Map(groups.map((g) => [g.id, g] as const));
  const tables: FieldMeTable[] = [];
  for (const p of paceByGroup(records)) {
    const g = byId.get(p.groupId);
    if (!g || p.count === 0) continue; // マスタに無いグループ／完了0件の行は出さない
    const target = { yellowMin: g.paceYellowMin, greenMin: g.paceGreenMin };
    const badge = paceBadge(p.perHour, target);
    tables.push({
      groupId: p.groupId,
      groupName: g.name,
      count: p.count,
      workedMin: p.workedMin,
      perHour: p.perHour,
      badge,
      badgeText: badge ? paceBadgeText(badge, target) : null,
      targetYellowMin: g.paceYellowMin,
      revisit: p.revisit,
      reason: p.reason,
      current: p.groupId === groupId,
    });
  }

  // ② 作業ペース ＝ いま作業しているテーブルの行。
  const mine = tables.find((t) => t.groupId === groupId);

  return {
    groupId: groupId ?? null,
    groupName: group?.name ?? null,
    count,
    workedMin: mine?.workedMin ?? 0,
    perHour: mine?.perHour ?? null,
    badge: mine?.badge ?? null,
    badgeText: mine?.badgeText ?? null,
    targetYellowMin: group?.paceYellowMin ?? null,
    revisit: mine?.revisit ?? false,
    reason: mine?.reason ?? 'no_scan',
    tables,
  };
}
