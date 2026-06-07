/**
 * PUT /api/notices/[id]/read
 * 連絡事項の既読化（Sprint Y-16 で per-staff 管理に拡張）。
 *
 * 認証:
 *   admin / manager … inbox（着信）の既読化 → Notice.readAt を更新（管理 PC 一括）
 *   staff           … announce の既読化 → NoticeAck (notice_id, staff_code) を upsert（個別）
 *
 * 副作用:
 *   BadgeCounts.ann は次回 SSE で再配信。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function PUT(
  _req: Request,
  { params }: { params: { id: string } },
) {
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
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'notice が見つかりません' },
      { status: 404 },
    );
  }

  // ロール × kind の整合性チェック
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

  // Sprint Y-16: モバイル → 個別 ack（NoticeAck）／ PC → 全体 readAt
  if (guard.auth.source === 'mobile') {
    const staffCode = guard.auth.staffCode;
    if (!staffCode) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: '社員コードが取得できません' },
        { status: 403 },
      );
    }
    await prisma.noticeAck.upsert({
      where: { noticeId_staffCode: { noticeId: id, staffCode } },
      create: { noticeId: id, staffCode },
      update: {}, // 既に ack 済みなら何もしない（acked_at は維持）
    });
    return NextResponse.json({
      data: { id, staffCode, ackedAt: new Date().toISOString() },
      message: 'OK',
    });
  }

  // PC（admin/manager）: 旧来通り Notice.readAt をグローバルに更新
  const updated = await prisma.notice.update({
    where: { id },
    data: {
      readAt: notice.readAt ?? new Date(),
      readBy: guard.auth.staffCode ?? null,
    },
  });
  return NextResponse.json({ data: updated, message: 'OK' });
}
