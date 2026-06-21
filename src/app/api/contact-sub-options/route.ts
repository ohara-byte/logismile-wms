/**
 * GET /api/contact-sub-options
 *
 * 2026-06-21（②）: 本部連絡モーダル（タブレット／ハンディ）用のサブ選択肢取得。
 *   有効な選択肢のみを分類・表示順で返す。マスタ画面（/api/master/...）は
 *   master_view 権限が必要だが、現場端末（mobile セッション）はそれを持たないため、
 *   staff も許可するこの軽量エンドポイントを別に用意する。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET() {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;
  const items = await prisma.contactSubOption.findMany({
    where: { active: true },
    select: { id: true, category: true, label: true, sortOrder: true },
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
  });
  return NextResponse.json({ data: { items }, message: 'OK' });
}
