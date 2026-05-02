/**
 * GET /api/master/boxes/suggest?pkNo=
 * 箱候補提案（Phase 6 完成版）
 *
 * 内部実装は src/lib/box-selector.ts に集約。容積計算 + 親商品逆引き + 冷凍判定を行う。
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import { selectBoxForOrder } from '@/lib/box-selector';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const pkNo = searchParams.get('pkNo');
  if (!pkNo) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'pkNo は必須です' },
      { status: 422 },
    );
  }

  try {
    const result = await selectBoxForOrder(pkNo);
    return NextResponse.json({ data: result, message: 'OK' });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('見つかりません')) {
      return NextResponse.json({ error: 'NOT_FOUND', message: msg }, { status: 404 });
    }
    console.error('[GET /api/master/boxes/suggest]', e);
    return NextResponse.json(
      { error: 'INTERNAL', message: '箱選定処理に失敗しました' },
      { status: 500 },
    );
  }
}
