/**
 * POST /api/cron/update-std-times
 * 標準時間の自動更新（Phase 6-8）
 *
 * 権限: admin/manager 手動トリガー
 *  ※ 将来は外部 cron から CRON_SECRET ヘッダで叩く想定
 *
 * クエリ: windowDays（既定 30）
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import { updateStdTimes } from '@/lib/stats-updater';

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const windowDays = Math.max(
    1,
    Math.min(180, parseInt(searchParams.get('windowDays') ?? '30', 10) || 30),
  );

  try {
    const result = await updateStdTimes(windowDays);
    return NextResponse.json({ data: result, message: 'OK' });
  } catch (e) {
    console.error('[POST /api/cron/update-std-times]', e);
    return NextResponse.json(
      { error: 'INTERNAL', message: '標準時間の更新に失敗しました' },
      { status: 500 },
    );
  }
}
