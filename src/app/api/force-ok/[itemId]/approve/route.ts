/**
 * POST /api/force-ok/[itemId]/approve
 * 強制OK の承認
 *
 * 認証: admin / manager のみ
 * 副作用: 関連 Alert（type='force_ok', refCode=itemId）を resolved に
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/auth/permissions';

export async function POST(
  _req: Request,
  { params }: { params: { itemId: string } },
) {
  // Sprint Y-11: 強制OK 承認は force_approve 権限（admin/manager のみ）
  const guard = await requirePermission('force_approve');
  if (!guard.ok) return guard.response;

  const id = parseInt(params.itemId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: '不正な itemId' },
      { status: 422 },
    );
  }

  const item = await prisma.shippingOrderItem.findUnique({
    where: { id },
    select: { id: true, forceOk: true, forceApprovalStatus: true },
  });
  if (!item) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'item が見つかりません' }, { status: 404 });
  }
  if (!item.forceOk) {
    return NextResponse.json(
      { error: 'CONFLICT', message: '強制OK ではない明細です' },
      { status: 409 },
    );
  }
  if (item.forceApprovalStatus) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `既に ${item.forceApprovalStatus} 済みです` },
      { status: 409 },
    );
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.shippingOrderItem.update({
      where: { id },
      data: {
        forceApprovalStatus: 'approved',
        forceApprovedAt: now,
        forceApprovedBy: guard.auth.staffCode ?? guard.auth.email ?? 'unknown',
        forceRejectReason: null,
      },
    }),
    prisma.alert.updateMany({
      where: { type: 'force_ok', refCode: String(id), resolved: false },
      data: {
        resolved: true,
        resolvedAt: now,
        resolvedBy: guard.auth.staffCode ?? null,
      },
    }),
  ]);

  return NextResponse.json({ data: { itemId: id, status: 'approved' }, message: 'OK' });
}
