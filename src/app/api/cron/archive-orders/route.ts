/**
 * POST /api/cron/archive-orders?dryRun=false&retentionDays=365
 * 年次バッチ：論理削除されてから retentionDays（既定 365 日）以上経った伝票を
 *  - CSV にアーカイブ
 *  - dryRun=false なら物理削除
 *
 * 権限: admin のみ（取り返しのつかない処理のため）
 *
 * dryRun=true (既定) では削除候補とアーカイブ CSV のみ生成し、DB は触らない。
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import { archiveOldDeletedOrders } from '@/lib/archive-orders';

export async function POST(req: Request) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get('dryRun') !== 'false';
  const retentionDays = Math.max(
    1,
    Math.min(3650, parseInt(searchParams.get('retentionDays') ?? '365', 10) || 365),
  );

  try {
    const result = await archiveOldDeletedOrders({ dryRun, retentionDays });
    return NextResponse.json({ data: result, message: 'OK' });
  } catch (e) {
    console.error('[POST /api/cron/archive-orders]', e);
    return NextResponse.json(
      { error: 'INTERNAL', message: '年次アーカイブ処理に失敗しました' },
      { status: 500 },
    );
  }
}
