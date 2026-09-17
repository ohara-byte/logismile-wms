/**
 * 検品タイムラインの DB 取得（現場依頼・2026-09-17）。
 *
 * ★ 件数が大きい：1日 2,000〜3,000 件 ×（依頼例の）6月1日〜現在。
 *   まとめて findMany すると 20〜30 万行がメモリに載るため、
 *   **カーソル分割**で取り、CSV は書き出しながら流す。
 *
 * 純ロジック（行の組み立て・ラベル）は insp-timeline.ts。
 */

import { prisma } from './db';
import type { PeriodRange } from './report-period';
import type { TimelineBasis, TimelineSource } from './insp-timeline';

/** 1回の取得件数。CSV ストリーミングのチャンク。 */
export const TIMELINE_PAGE_SIZE = 2000;

/**
 * 期間の絞り込み条件。
 *
 * - `ship`  … 伝票の出荷予定日（`@db.Date`）。UTC 暦日の半開区間で絞る
 *             （JST 境界を使うと1日ずれる。date-utils / report-period.ts 参照）。
 * - `start` … 検品着手時刻（`@db.Timestamptz`）。JST ローカル日の境界を使う。
 *
 * ★ 削除済み（＝現場の言う「キャンセル」）も**含める**。
 *   依頼「全ステータスを出力対象とする（保留・キャンセルも含める）」のため、
 *   ここでは deletedAt で絞らない。
 */
export function timelineWhere(period: PeriodRange, basis: TimelineBasis) {
  if (basis === 'start') {
    return {
      inspSession: { is: { startedAt: { gte: period.from, lte: period.to } } },
    };
  }
  return {
    shipDate: { gte: period.fromDate, lt: period.toDateExclusive },
  };
}

const SELECT = {
  pkNo: true,
  shipDate: true,
  status: true,
  deletedAt: true,
  noshiName: true,
  noshiPerson: true,
  _count: { select: { items: true } },
  inspSession: {
    select: { staffCode: true, startedAt: true, completedAt: true },
  },
} as const;

type Row = {
  pkNo: string;
  shipDate: Date;
  status: string;
  deletedAt: Date | null;
  noshiName: string | null;
  noshiPerson: string | null;
  _count: { items: number };
  inspSession: { staffCode: string; startedAt: Date; completedAt: Date | null } | null;
};

function toSource(r: Row): TimelineSource {
  return {
    shipDate: r.shipDate,
    pkNo: r.pkNo,
    status: r.status,
    deletedAt: r.deletedAt,
    noshiName: r.noshiName,
    noshiPerson: r.noshiPerson,
    itemCount: r._count.items,
    session: r.inspSession,
  };
}

export async function countTimeline(
  period: PeriodRange,
  basis: TimelineBasis,
): Promise<number> {
  return prisma.shippingOrder.count({ where: timelineWhere(period, basis) });
}

/**
 * 1ページぶん取得する。
 * `cursorPkNo` の次から `take` 件。pkNo は @unique なので並びの同点崩しになり、
 * カーソルが行を飛ばしたり重複したりしない。
 */
export async function fetchTimelinePage(
  period: PeriodRange,
  basis: TimelineBasis,
  take: number,
  cursorPkNo: string | null,
): Promise<TimelineSource[]> {
  const rows = (await prisma.shippingOrder.findMany({
    where: timelineWhere(period, basis),
    select: SELECT,
    orderBy: [{ shipDate: 'asc' }, { pkNo: 'asc' }],
    take,
    ...(cursorPkNo ? { cursor: { pkNo: cursorPkNo }, skip: 1 } : {}),
  })) as Row[];
  return rows.map(toSource);
}

/**
 * 担当者コード → 氏名。
 * 担当者マスタは数十件なので一度に読み、ページごとの問い合わせを避ける。
 */
export async function loadStaffNames(): Promise<(code: string) => string> {
  const staff = await prisma.staff.findMany({ select: { code: true, name: true } });
  const map = new Map(staff.map((s) => [s.code, s.name]));
  return (code: string) => map.get(code) ?? '';
}

/**
 * エアパックの判定語（`pack.airpack_keyword`）。
 * 未設定なら ''。その場合エアパック欄は空になる（判定できないため）。
 */
export async function loadAirpackKeyword(): Promise<string> {
  const s = await prisma.appSetting.findUnique({
    where: { key: 'pack.airpack_keyword' },
    select: { value: true },
  });
  return (s?.value ?? '').trim();
}
