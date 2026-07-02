/**
 * GET /api/dashboard/progress?date=YYYY-MM-DD
 * 全体進捗 + グループ別進捗 + 段階目標 + 1時間別実績 + 30分要員配置
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import { todayJstAsUTC, parseDateAsUTC, formatDateYmd } from '@/lib/date-utils';
import {
  getOverallProgress,
  getGroupProgresses,
  getHourlyProgress,
  getHourlyChart,
  getStaffAllocationGrid,
} from '@/lib/dashboard/progress';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  // 既定の「本日」は JST 暦日（todayJstAsUTC＝UTC真夜中で表現）。日付根治(2026-07-02)で
  //   ship_date を正しい暦日に補正済みのため、全 shipDate クエリと同じ UTC 基準で当日を決める。
  const dateStr = searchParams.get('date') ?? formatDateYmd(todayJstAsUTC());
  const date = parseDateAsUTC(dateStr);
  if (!date) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${dateStr}` },
      { status: 422 },
    );
  }

  const overall = await getOverallProgress(date);
  const [groups, hourly, hourlyChart, staffGrid] = await Promise.all([
    getGroupProgresses(date),
    getHourlyProgress(date, overall.total, overall.packed),
    getHourlyChart(date),
    getStaffAllocationGrid(date),
  ]);

  return NextResponse.json({
    data: { overall, groups, hourly, hourlyChart, staffGrid },
    message: 'OK',
  });
}
