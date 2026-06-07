/**
 * POST /api/allocation/auto-carryover?date=YYYY-MM-DD
 *
 * Sprint Z-8: 出荷残の手動翌日繰越（admin/manager の管理操作）。
 *  - 工場連携モード未稼働でも、手動で実行できるエスケープハッチ
 *  - 引当未完了伝票の shipDate を翌日に進める
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/permissions';
import { runDailyCarryover } from '@/lib/allocation/daily-carryover';

const Query = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const parsed = Query.safeParse({ date: searchParams.get('date') });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'date クエリ必須 (YYYY-MM-DD)' },
      { status: 422 },
    );
  }

  const result = await runDailyCarryover(parsed.data.date, 'manual');
  return NextResponse.json({ data: result, message: 'OK' });
}
