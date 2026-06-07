/**
 * GET /api/shifts/today?date=YYYY-MM-DD
 * 指定日のシフト（メンバー割当ガントの初期化用）
 *
 * Sprint O: 出勤者だけでなく休みメンバーも含めて返す（Gantt 側で 💤 表示するため）。
 * isOff フラグも併せて返却。
 * Sprint Y-13: date クエリで未来日のシフトも取得可能に。未指定時は本日。
 *
 * 2026-05-20 修正：日付パースを JST 安全な UTC 真夜中に統一（1 日ずれバグ解消）。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC, todayJstAsUTC, formatDateYmd } from '@/lib/date-utils';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get('date');
  const target = dateStr ? parseDateAsUTC(dateStr) : todayJstAsUTC();
  if (!target) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${dateStr}` },
      { status: 422 },
    );
  }

  const items = await prisma.shift.findMany({
    where: { date: target },
    include: {
      staff: { select: { code: true, name: true, kana: true, groupId: true, defaultShiftPattern: true } },
      pattern: {
        select: { code: true, name: true, isOff: true, startTime: true, endTime: true },
      },
    },
    orderBy: { staffCode: 'asc' },
  });

  return NextResponse.json({
    data: { items, date: formatDateYmd(target) },
    message: 'OK',
  });
}
