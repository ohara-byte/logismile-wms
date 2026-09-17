/**
 * レポート集計ロジック（Phase 5-17 〜 5-21）
 *
 * 提供:
 *  - サマリー（出荷件数 / 完了 / 強制OK / 平均梱包時間 / 総MH）
 *  - 担当者別 MH（処理件数 / 作業時間 / MH）
 *  - グループ別 MH（テーブル別 × 1 時間刻み の処理件数）
 *  - 商品 ABC 分析（出荷頻度・数量ランキング）
 *  - ヒートマップ（時間帯 × 曜日 / 運送会社締切駆け込み）
 */

import { prisma } from './db';
import { addDaysUTC, formatDateYmd, jstYmd } from './date-utils';
import type { PeriodRange } from './report-period';
import {
  assignedMinutesByGroup,
  assignedMinutesByStaff,
  groupAt,
  indexBars,
  jstDayAndMinute,
  minutesToHours,
  perHour,
  type AssignmentBar,
} from './assigned-hours';

/**
 * 期間内のメンバー割当（ガント）を読む。MHT の元になる「テーブル配置時間」。
 *
 * `member_assignments.date` は `@db.Date`（UTC 真夜中）なので、
 * JST 境界の from/to ではなく **UTC 暦日の半開区間**で絞る
 * （JST 境界を使うと前日1日ぶんを巻き込む。date-utils の注記と同じ）。
 */
async function loadAssignmentBars(period: PeriodRange): Promise<AssignmentBar[]> {
  const rows = await prisma.memberAssignment.findMany({
    where: { date: { gte: period.fromDate, lt: period.toDateExclusive } },
    select: { date: true, staffCode: true, groupId: true, startTime: true, endTime: true },
  });
  return rows.map((r) => ({
    dateKey: formatDateYmd(r.date),
    staffCode: r.staffCode,
    groupId: r.groupId,
    startTime: r.startTime,
    endTime: r.endTime,
  }));
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

function startOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOf(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * サマリーレポート（日別 / 期間合計）— Sprint I-3b: pane の期待形に合わせて拡張。
 *
 * 返却:
 *   {
 *     from, to,
 *     daily: [{ date, weekday, shipped, packed, packMin, manHours, forceOk, staffCount }],
 *     total: { shipped, packed, packMin, manHours, forceOk },
 *     avg:   { perDay, perOrderMin },
 *     best:  { date, shipped },
 *     worst: { date, shipped },
 *   }
 */
export async function summaryReport(period: PeriodRange) {
  // shipDate は @db.Date（UTC 真夜中）。setHours 由来の境界を使うと前日1日分を
  //   余計に拾う（2026-08-07 是正）。UTC 暦日の [fromDate, toDateExclusive) を使う。
  // completedAt は @db.Timestamptz なので従来どおり JST ローカル日の境界を使う。
  const orders = await prisma.shippingOrder.findMany({
    where: {
      shipDate: { gte: period.fromDate, lt: period.toDateExclusive },
      deletedAt: null,
    },
    select: { id: true, status: true, shipDate: true },
  });
  const sessions = await prisma.inspSession.findMany({
    where: { completedAt: { gte: period.from, lte: period.to, not: null } },
    select: {
      staffCode: true,
      durationSec: true,
      forceOkCount: true,
      completedAt: true,
    },
  });

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  // 日付キー（YYYY-MM-DD）でバケット
  type Bucket = {
    shipped: number;
    packed: number;
    packSec: number; // 検品セッション所要時間合計（秒）
    forceOk: number;
    staffSet: Set<string>;
  };
  const byDay = new Map<string, Bucket>();
  function get(key: string): Bucket {
    let b = byDay.get(key);
    if (!b) {
      b = { shipped: 0, packed: 0, packSec: 0, forceOk: 0, staffSet: new Set() };
      byDay.set(key, b);
    }
    return b;
  }

  // 出荷指示 → shipped/packed
  for (const o of orders) {
    const key = o.shipDate.toISOString().slice(0, 10);
    const b = get(key);
    b.shipped++;
    if (o.status === 'packed' || o.status === 'shipped') b.packed++;
  }

  // 検品セッション → 完了日でカウント。
  //   completedAt はインスタントなので toISOString だと UTC 暦日になり、
  //   JST 00:00〜08:59 完了分が前日に混ざる（2026-08-07 是正）。
  for (const s of sessions) {
    if (!s.completedAt) continue;
    const key = jstYmd(s.completedAt);
    const b = get(key);
    b.packSec += s.durationSec ?? 0;
    b.forceOk += s.forceOkCount ?? 0;
    if (s.staffCode) b.staffSet.add(s.staffCode);
  }

  // 期間内の全日付を埋める（出荷ゼロ日も daily に含める）
  const daily: Array<{
    date: string;
    weekday: string;
    shipped: number;
    packed: number;
    packMin: number;
    manHours: number;
    forceOk: number;
    staffCount: number;
  }> = [];
  // UTC 暦日で [fromDate, toDateExclusive) を走査する。
  //   従来は JST 真夜中（= UTC 前日15:00）起点だったため、日付キーが1日前にずれ、
  //   最終日のバケットが落ち、曜日ラベルも日付と食い違っていた（2026-08-07 是正）。
  for (
    let d = period.fromDate;
    d < period.toDateExclusive;
    d = addDaysUTC(d, 1)
  ) {
    const key = formatDateYmd(d);
    const b = byDay.get(key);
    daily.push({
      date: key,
      weekday: WEEKDAYS[d.getUTCDay()],
      shipped: b?.shipped ?? 0,
      packed: b?.packed ?? 0,
      packMin: b ? Math.round((b.packSec / 60) * 10) / 10 : 0,
      manHours: b ? Math.round((b.packSec / 3600) * 100) / 100 : 0,
      forceOk: b?.forceOk ?? 0,
      staffCount: b?.staffSet.size ?? 0,
    });
  }

  const totalShipped = daily.reduce((s, d) => s + d.shipped, 0);
  const totalPacked = daily.reduce((s, d) => s + d.packed, 0);
  const totalPackMin = daily.reduce((s, d) => s + d.packMin, 0);
  const totalManHours = daily.reduce((s, d) => s + d.manHours, 0);
  const totalForceOk = daily.reduce((s, d) => s + d.forceOk, 0);

  const days = daily.length || 1;
  const perDay = Math.round(totalShipped / days);
  const perOrderMin = totalShipped > 0 ? (totalManHours * 60) / totalShipped : 0;

  const sorted = [...daily].sort((a, b) => b.shipped - a.shipped);
  const best = sorted[0] ?? { date: '', shipped: 0 };
  const worst = sorted[sorted.length - 1] ?? { date: '', shipped: 0 };

  // 後方互換: 旧 /reports ページや CSV 出力が依存していたフラット フィールド
  const totalDurationSec = sessions.reduce((s, x) => s + (x.durationSec ?? 0), 0);
  const avgPackingSec =
    sessions.length > 0 ? Math.round(totalDurationSec / sessions.length) : null;

  return {
    from: formatDateYmd(period.fromDate),
    to: formatDateYmd(addDaysUTC(period.toDateExclusive, -1)),
    daily,
    total: {
      shipped: totalShipped,
      packed: totalPacked,
      packMin: Math.round(totalPackMin * 10) / 10,
      manHours: Math.round(totalManHours * 100) / 100,
      forceOk: totalForceOk,
    },
    avg: {
      perDay,
      perOrderMin: Math.round(perOrderMin * 100) / 100,
    },
    best: { date: best.date, shipped: best.shipped },
    worst: { date: worst.date, shipped: worst.shipped },
    // 旧仕様互換（/reports ページ・CSV 出力など）
    totalShipped,
    totalPacked,
    completedCount: sessions.length,
    forceOkCount: totalForceOk,
    avgPackingSec,
    totalMhHours: Math.round(totalManHours * 100) / 100,
  };
}

/**
 * 担当者別 MH ＋ **MHT**（小原様 2026-09-17）。
 *
 * - `mhHours`  … MH（従来）＝ Σ(検品完了 − 検品着手)。手を動かしていた時間。
 * - `mhtHours` … MHT（新設）＝ Σ(メンバー割当ガントの配置時間)。テーブルに居た時間。
 * - `perMh` / `perMht` … 1人時あたりの件数。配置が無い（ガント未登録）担当者は
 *   `mhtHours = 0` となり `perMht` は **null**（画面では「—」）。
 *
 * 行の顔ぶれは従来どおり「期間内に検品したことがある担当者」。
 * 配置だけあって検品が無い担当者（ライン・仕分など）は増やさない。
 */
export async function staffMhReport(period: PeriodRange) {
  const sessions = await prisma.inspSession.findMany({
    where: {
      completedAt: { gte: period.from, lte: period.to },
      durationSec: { not: null },
    },
    select: { staffCode: true, durationSec: true },
  });

  const map = new Map<string, { count: number; sec: number }>();
  for (const s of sessions) {
    const cur = map.get(s.staffCode) ?? { count: 0, sec: 0 };
    cur.count += 1;
    cur.sec += s.durationSec ?? 0;
    map.set(s.staffCode, cur);
  }

  const staffNames = await prisma.staff.findMany({
    where: { code: { in: Array.from(map.keys()) } },
    select: { code: true, name: true },
  });
  const nameMap = new Map(staffNames.map((s) => [s.code, s.name]));

  const assignedMin = assignedMinutesByStaff(await loadAssignmentBars(period));

  return Array.from(map.entries())
    .map(([code, v]) => {
      const mhHours = Math.round((v.sec / 3600) * 100) / 100;
      const mhtHours = minutesToHours(assignedMin.get(code) ?? 0);
      return {
        staffCode: code,
        staffName: nameMap.get(code) ?? code,
        count: v.count,
        durationSec: v.sec,
        mhHours,
        mhtHours,
        perMh: perHour(v.count, mhHours),
        perMht: perHour(v.count, mhtHours),
        avgSec: v.count > 0 ? Math.round(v.sec / v.count) : 0,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * グループ別 MH ＋ **MHT**（小原様 2026-09-17）。
 *
 * ★ 既存の `count` / `mhHours` は **担当者マスタの所属グループ**（staff.group_id）で
 *   数えている。一方 MHT の元になる配置（メンバー割当ガント）は日ごとに動き、
 *   保存しても担当者マスタは書き換えない。両者はずれうるため、
 *   **`mhtCount` は「そのとき実際に配置されていたグループ」で数え直す**。
 *   既存の数字は変えない（黙って変わると現場が混乱するため）。
 *
 * - `mhtHours`  … そのグループへの配置時間の合計（人時）
 * - `mhtCount`  … 配置時間帯の中で完了した検品の件数
 * - `perMht`    … mhtCount ÷ mhtHours（1人時あたりの梱包件数）。配置が無ければ null
 */
export async function groupMhReport(period: PeriodRange) {
  // staff.group_id を JOIN で集計
  const sessions = await prisma.inspSession.findMany({
    where: {
      completedAt: { gte: period.from, lte: period.to },
      durationSec: { not: null },
    },
    select: { staffCode: true, durationSec: true, completedAt: true },
  });

  const staffGroups = await prisma.staff.findMany({
    where: { code: { in: Array.from(new Set(sessions.map((s) => s.staffCode))) } },
    select: { code: true, groupId: true },
  });
  const groupMap = new Map(staffGroups.map((s) => [s.code, s.groupId]));

  const groups = await prisma.inspectionGroup.findMany({ select: { id: true, name: true } });
  const groupNameMap = new Map(groups.map((g) => [g.id, g.name]));

  // group × hour の行列
  type Cell = { count: number; sec: number };
  const matrix = new Map<string, Map<number, Cell>>();
  for (const s of sessions) {
    const gId = groupMap.get(s.staffCode) ?? 'UNASSIGNED';
    const hour = s.completedAt!.getHours();
    if (!matrix.has(gId)) matrix.set(gId, new Map());
    const row = matrix.get(gId)!;
    const cur = row.get(hour) ?? { count: 0, sec: 0 };
    cur.count++;
    cur.sec += s.durationSec ?? 0;
    row.set(hour, cur);
  }

  // ── MHT（配置基準）──
  const bars = await loadAssignmentBars(period);
  const assignedMin = assignedMinutesByGroup(bars);
  const barIdx = indexBars(bars);
  const mhtCountByGroup = new Map<string, number>();
  for (const s of sessions) {
    if (!s.completedAt) continue;
    const { dateKey, minute } = jstDayAndMinute(s.completedAt);
    const gId = groupAt(barIdx, s.staffCode, dateKey, minute);
    if (!gId) continue; // 配置の時間外に完了したものは分母(配置時間)に対応しない
    mhtCountByGroup.set(gId, (mhtCountByGroup.get(gId) ?? 0) + 1);
  }

  // 配置だけあって検品が無かったグループも行として出す（件/MHT が 0 と分かる）
  const groupIds = new Set<string>([...matrix.keys(), ...assignedMin.keys()]);

  return Array.from(groupIds).map((gId) => {
    const row = matrix.get(gId) ?? new Map<number, Cell>();
    const mhtHours = minutesToHours(assignedMin.get(gId) ?? 0);
    const mhtCount = mhtCountByGroup.get(gId) ?? 0;
    return {
      groupId: gId,
      groupName: groupNameMap.get(gId) ?? gId,
      hourly: Array.from(row.entries())
        .map(([hour, c]) => ({
          hour,
          count: c.count,
          mhHours: Math.round((c.sec / 3600) * 100) / 100,
        }))
        .sort((a, b) => a.hour - b.hour),
      totalCount: Array.from(row.values()).reduce((s, c) => s + c.count, 0),
      totalMhHours:
        Math.round(
          (Array.from(row.values()).reduce((s, c) => s + c.sec, 0) / 3600) * 100,
        ) / 100,
      mhtHours,
      mhtCount,
      perMht: perHour(mhtCount, mhtHours),
    };
  });
}

export async function productAbcReport(period: PeriodRange, top = 30) {
  const items = await prisma.shippingOrderItem.groupBy({
    by: ['productCode'],
    where: {
      // shipDate は @db.Date。UTC 暦日の半開区間で絞る（2026-08-07 是正）
      order: {
        shipDate: { gte: period.fromDate, lt: period.toDateExclusive },
        deletedAt: null,
      },
    },
    _sum: { qty: true },
    _count: { _all: true },
  });

  const products = await prisma.product.findMany({
    where: { code: { in: items.map((i) => i.productCode) } },
    select: { code: true, name: true, cat: true },
  });
  const pMap = new Map(products.map((p) => [p.code, p]));

  const sorted = items
    .map((i) => ({
      productCode: i.productCode,
      productName: pMap.get(i.productCode)?.name ?? i.productCode,
      category: pMap.get(i.productCode)?.cat ?? 'unknown',
      orderCount: i._count._all,
      totalQty: i._sum.qty ?? 0,
    }))
    .sort((a, b) => b.totalQty - a.totalQty);

  // ABC 区分: 累積比率 80% を A、80-95% を B、それ以降 C
  const totalQty = sorted.reduce((s, x) => s + x.totalQty, 0);
  let cum = 0;
  const ranked = sorted.map((x) => {
    cum += x.totalQty;
    const ratio = totalQty > 0 ? cum / totalQty : 0;
    const cls = ratio <= 0.8 ? 'A' : ratio <= 0.95 ? 'B' : 'C';
    return { ...x, cumRatio: Math.round(ratio * 1000) / 10, abc: cls };
  });

  return ranked.slice(0, top);
}

export interface HeatmapCell {
  weekday: string;
  hour: number;
  count: number;
  level: 'low' | 'mid' | 'high';
}

export async function heatmapReport(from: Date, to: Date) {
  const sessions = await prisma.inspSession.findMany({
    where: {
      completedAt: { gte: startOf(from), lte: endOf(to) },
    },
    select: { completedAt: true },
  });

  const counts = new Map<string, number>(); // key = "weekday|hour"
  for (const s of sessions) {
    const d = s.completedAt!;
    const key = `${d.getDay()}|${d.getHours()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const max = Math.max(0, ...Array.from(counts.values()));
  const rows: HeatmapCell[] = [];
  for (let wd = 0; wd <= 6; wd++) {
    for (let h = 9; h <= 19; h++) {
      const c = counts.get(`${wd}|${h}`) ?? 0;
      const level: HeatmapCell['level'] =
        max === 0 ? 'low' : c < max / 3 ? 'low' : c < (max * 2) / 3 ? 'mid' : 'high';
      rows.push({ weekday: WEEKDAYS[wd], hour: h, count: c, level });
    }
  }

  // 運送会社締切駆け込み: cutoff 直前 60 分の packed 件数
  const carriers = await prisma.carrier.findMany({
    where: { active: true, cutoff: { not: null } },
    select: { code: true, name: true, cutoff: true },
  });
  const carrierCutoffs = await Promise.all(
    carriers.map(async (c) => {
      const [hh, mm] = c.cutoff!.split(':').map((x) => parseInt(x, 10));
      const cutoffMin = hh * 60 + mm;
      const rushCount = sessions.filter((s) => {
        const d = s.completedAt!;
        const sessionMin = d.getHours() * 60 + d.getMinutes();
        return cutoffMin - 60 <= sessionMin && sessionMin <= cutoffMin;
      }).length;
      return { carrier: c.name, cutoff: c.cutoff!, rushCount };
    }),
  );

  return { rows, carrierCutoffs };
}
