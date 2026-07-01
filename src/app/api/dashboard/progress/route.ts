/**
 * GET /api/dashboard/progress?date=YYYY-MM-DD
 * 全体進捗 + グループ別進捗 + 段階目標 + 1時間別実績 + 30分要員配置
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
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
  // 既定の「本日」は JST 8:00 始業を境界にした業務日（8時前は前日・8時以降は当日）。
  //   toISOString() は常に UTC。JST=UTC+9 で 8時境界なので、現在UTCに +1h した日付が業務日になる。
  //   （旧実装は素の UTC 日付＝JST 09:00 でしか日付が切り替わらず「9時切替」になっていた）
  const jstBusinessDate = new Date(Date.now() + 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const dateStr = searchParams.get('date') ?? jstBusinessDate;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
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
