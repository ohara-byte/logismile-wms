/**
 * GET /api/notices/recipients?date=YYYY-MM-DD
 *
 * 伝票詳細モーダルの宛先ピッカー用。
 * 作業テーブル一覧と、各テーブルの「当日の担当者」（割当ガント由来）を返す。
 *
 * 返却:
 *   { data: { date, tables: [{ code, groupId, groupName, staff: [{ code, name, startTime, endTime }] }] } }
 *
 * date 省略時は今日（JST）。管理 PC 限定。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC, todayJstAsUTC, formatDateYmd } from '@/lib/date-utils';
import { listTableRecipients } from '@/lib/notice-recipients';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get('date');
  const date = dateStr ? parseDateAsUTC(dateStr) : todayJstAsUTC();
  if (!date) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${dateStr}` },
      { status: 422 },
    );
  }

  const tables = await listTableRecipients(date);

  // 端末単位の宛先も同じ画面から選べるよう、稼働中の端末種別を添える。
  //   （タブレットが 1 台も無い日に「タブレット全体」を出しても届かないため）
  const devices = await prisma.device.groupBy({
    by: ['type'],
    where: { active: true },
    _count: { _all: true },
  });
  const deviceCounts = Object.fromEntries(
    devices.map((d) => [d.type, d._count._all]),
  ) as Record<string, number>;

  return NextResponse.json({
    data: { date: formatDateYmd(date), tables, deviceCounts },
    message: 'OK',
  });
}
