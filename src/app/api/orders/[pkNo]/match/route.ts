/**
 * PUT /api/orders/[pkNo]/match
 * 照合状態を更新（A-12）
 *
 * リクエスト: { status: 'none' | 'barcode' | 'visual' }
 *   - 'none' でクリア
 *   - 'barcode' でバーコード照合済
 *   - 'visual' で目視チェック済
 *
 * 認証: admin / manager
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  status: z.enum(['none', 'barcode', 'visual']),
});

export async function PUT(
  req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const pkNo = decodeURIComponent(params.pkNo);
  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: null },
    select: { id: true, pkNo: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'ピッキング№が見つかりません' },
      { status: 404 },
    );
  }

  const isClear = parsed.data.status === 'none';
  const updated = await prisma.shippingOrder.update({
    where: { id: order.id },
    data: {
      matchStatus: parsed.data.status,
      matchedAt: isClear ? null : new Date(),
      matchedBy: isClear ? null : guard.auth.staffCode ?? null,
    },
    select: {
      pkNo: true,
      matchStatus: true,
      matchedAt: true,
      matchedBy: true,
    },
  });

  return NextResponse.json({ data: updated, message: 'OK' });
}
