/**
 * PUT /api/notices/[id]/read
 * 連絡事項の既読化。
 *
 * 認証:
 *   admin / manager … inbox（着信）の既読化（管理 PC 操作）
 *   staff           … announce（発信）の既読化（モバイル ack_required フロー用）
 * 副作用: BadgeCounts.ann が即時減算される（次回 SSE で配信）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function PUT(
  _req: Request,
  { params }: { params: { id: string } },
) {
  // B-1 / H-4: モバイル端末からの announce 既読化を許可
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: '不正な ID' },
      { status: 422 },
    );
  }

  const notice = await prisma.notice.findUnique({
    where: { id },
    select: { id: true, kind: true, readAt: true },
  });
  if (!notice) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'notice が見つかりません' }, { status: 404 });
  }

  // ロール × kind の整合性チェック
  // - inbox の既読化は admin/manager のみ（管理 PC で受信した連絡を消化）
  // - announce の既読化は staff のみ（モバイル端末で「了解」タップ）
  if (guard.auth.source === 'mobile' && notice.kind !== 'announce') {
    return NextResponse.json(
      {
        error: 'FORBIDDEN',
        message: 'モバイルからは発信(announce)のみ既読化できます',
      },
      { status: 403 },
    );
  }
  if (guard.auth.source === 'pc' && notice.kind !== 'inbox') {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: '管理 PC からは着信(inbox)のみ既読化できます',
      },
      { status: 409 },
    );
  }

  const updated = await prisma.notice.update({
    where: { id },
    data: {
      readAt: notice.readAt ?? new Date(),
      readBy: guard.auth.staffCode ?? null,
    },
  });

  return NextResponse.json({ data: updated, message: 'OK' });
}
