/**
 * GET /api/admin/badges
 * ナビバッジの初期値（一発取得）。
 *
 * SSE 接続前のフォールバック / SSE 切断時の手動リフレッシュにも使用。
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import { getBadgeCounts } from '@/lib/dashboard/badges';

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const counts = await getBadgeCounts();
  return NextResponse.json({ data: counts, message: 'OK' });
}
