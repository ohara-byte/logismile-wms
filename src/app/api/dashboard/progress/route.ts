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
  // 既定の「本日」は UTC 日付（toISOString）で決める。出荷指示一覧など他の全画面と同一基準にし、
  //   出荷指示データ(shipDate)の実運用日付と一致させるため。
  //   ※ 以前「JST 8:00始業の業務日(+1h)」に寄せた実装(2290cf6)は、出荷指示データの日付運用と
  //     ずれて当日0件表示になったため差し戻し。ここは他画面と揃える（勝手に +1h 業務日へ戻さないこと）。
  const dateStr = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
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
