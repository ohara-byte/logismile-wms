/**
 * GET /api/orders/[pkNo]/audit-logs
 * 伝票の監査ログ取得（削除/復活/編集/QR印刷フラグ変更の履歴）
 *
 * 権限: admin/manager のみ
 * 削除済み伝票でも参照可。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(
  _req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const pkNo = decodeURIComponent(params.pkNo);
  const order = await prisma.shippingOrder.findUnique({
    where: { pkNo },
    select: { id: true, pkNo: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'ピッキング№が見つかりません' },
      { status: 404 },
    );
  }

  const items = await prisma.orderAuditLog.findMany({
    where: { orderId: order.id },
    orderBy: { actedAt: 'desc' },
    include: { staff: { select: { code: true, name: true } } },
  });

  return NextResponse.json({
    data: { pkNo: order.pkNo, items },
    message: 'OK',
  });
}
