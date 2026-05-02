/**
 * GET /api/dashboard/progress?date=YYYY-MM-DD
 * 全体進捗 + グループ別進捗 + 段階目標 vs 予測
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import {
  getOverallProgress,
  getGroupProgresses,
  getHourlyProgress,
} from '@/lib/dashboard/progress';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${dateStr}` },
      { status: 422 },
    );
  }

  const overall = await getOverallProgress(date);
  const groups = await getGroupProgresses(date);
  const hourly = await getHourlyProgress(date, overall.total, overall.packed);

  return NextResponse.json({
    data: { overall, groups, hourly },
    message: 'OK',
  });
}
