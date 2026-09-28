/**
 * GET /api/carriers/table-matrix?date=YYYY-MM-DD
 *
 * テーブルグループ × 配送業者 の**残件数**マトリクス（要望書 2026-09-27 要望④）。
 *
 *   > 現在の「運送」タブは出荷全体の合計での配送業者別内訳しかなく、
 *   > テーブル×配送業者のクロス集計ができないというギャップがあります。
 *   > 集荷時間が迫った際に、どのテーブルに何件残っているかをPC画面一つで
 *   > 把握できれば、現場への確認依頼や歩いての確認が不要になります。
 *
 * ★ 伝票単位の一覧は返さない（要望書：サマリのみで充分）。
 * ★ 合計行は運送タブのカードと一致させる（同じ「残件」の定義を使う）。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';
import { buildLetterToGroup, groupOfPkNo, UNCLASSIFIED } from '@/lib/dashboard/group-map';
import { parseDateAsUTC, todayJstAsUTC, formatDateYmd } from '@/lib/date-utils';

/** 残件＝まだ梱包が終わっていない伝票（packed / shipped 以外）。 */
const DONE_STATUS = ['packed', 'shipped'];

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const date = parseDateAsUTC(searchParams.get('date')) ?? todayJstAsUTC();

  try {
    const [groups, carriers, orders] = await Promise.all([
      prisma.inspectionGroup.findMany({
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, tables: true },
      }),
      prisma.carrier.findMany({
        orderBy: [{ priority: 'asc' }, { code: 'asc' }],
        select: { code: true, name: true, short: true, cool: true },
      }),
      prisma.shippingOrder.findMany({
        where: { shipDate: date, deletedAt: null },
        select: { pkNo: true, status: true, carrierCode: true },
      }),
    ]);

    const letterToGroup = buildLetterToGroup(groups);

    // groupId → carrierCode → 残件
    const cells = new Map<string, Map<string, number>>();
    const rowTotal = new Map<string, number>();
    const colTotal = new Map<string, number>();
    let grandTotal = 0;
    let hasUnclassified = false;

    for (const o of orders) {
      if (DONE_STATUS.includes(o.status)) continue;
      const gid = groupOfPkNo(letterToGroup, o.pkNo);
      if (gid === UNCLASSIFIED) hasUnclassified = true;
      let row = cells.get(gid);
      if (!row) {
        row = new Map();
        cells.set(gid, row);
      }
      row.set(o.carrierCode, (row.get(o.carrierCode) ?? 0) + 1);
      rowTotal.set(gid, (rowTotal.get(gid) ?? 0) + 1);
      colTotal.set(o.carrierCode, (colTotal.get(o.carrierCode) ?? 0) + 1);
      grandTotal++;
    }

    // グループは全部出す（残0でも行を消さない＝「終わった」ことが分かる）
    const rows = groups.map((g) => ({
      groupId: g.id,
      groupName: g.name,
      total: rowTotal.get(g.id) ?? 0,
      byCarrier: Object.fromEntries(
        carriers.map((c) => [c.code, cells.get(g.id)?.get(c.code) ?? 0]),
      ),
    }));

    // どのグループにも属さないテーブル文字の伝票があるときだけ末尾に足す
    if (hasUnclassified) {
      rows.push({
        groupId: UNCLASSIFIED,
        groupName: '未分類',
        total: rowTotal.get(UNCLASSIFIED) ?? 0,
        byCarrier: Object.fromEntries(
          carriers.map((c) => [c.code, cells.get(UNCLASSIFIED)?.get(c.code) ?? 0]),
        ),
      });
    }

    return NextResponse.json({
      data: {
        date: formatDateYmd(date),
        carriers,
        rows,
        total: {
          total: grandTotal,
          byCarrier: Object.fromEntries(carriers.map((c) => [c.code, colTotal.get(c.code) ?? 0])),
        },
      },
      message: 'OK',
    });
  } catch (e) {
    return maskError(
      '[GET /api/carriers/table-matrix]',
      e,
      'INTERNAL',
      500,
      'テーブル別 残件数の取得に失敗しました',
    );
  }
}
