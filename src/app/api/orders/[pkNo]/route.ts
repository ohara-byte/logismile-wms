/**
 * GET /api/orders/[pkNo]
 * 出荷指示詳細（ピッキング№で検索）
 *
 * 権限: admin / manager / staff（検品作業のため staff も可）
 * 論理削除されたものは返さない（deleted_at IS NULL）。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(
  _req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const pkNo = decodeURIComponent(params.pkNo);
  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: null },
    include: {
      carrier: { select: { code: true, name: true, short: true, cool: true } },
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          product: { select: { code: true, name: true, jan: true, frozen: true, special: true } },
        },
      },
      inspSession: {
        select: {
          id: true,
          staffCode: true,
          deviceCode: true,
          startedAt: true,
          completedAt: true,
          boxCode: true,
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: `ピッキング№が見つかりません: ${pkNo}` },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: order, message: 'OK' });
}
