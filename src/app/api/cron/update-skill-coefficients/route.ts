/**
 * POST /api/cron/update-skill-coefficients
 * スキル係数の自動更新（Phase 6-9）
 *
 * 権限: admin/manager 手動トリガー
 * クエリ: windowDays（既定 30）
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import { updateSkillCoefficients } from '@/lib/stats-updater';

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const windowDays = Math.max(
    1,
    Math.min(180, parseInt(searchParams.get('windowDays') ?? '30', 10) || 30),
  );

  try {
    const result = await updateSkillCoefficients(windowDays);
    return NextResponse.json({ data: result, message: 'OK' });
  } catch (e) {
    console.error('[POST /api/cron/update-skill-coefficients]', e);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'スキル係数の更新に失敗しました' },
      { status: 500 },
    );
  }
}
