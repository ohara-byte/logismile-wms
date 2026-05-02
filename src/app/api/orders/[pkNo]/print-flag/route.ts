/**
 * PUT /api/orders/[pkNo]/print-flag
 * QR印刷フラグの手動切替（検品画面でのタップ操作）
 *
 * 処理:
 *  1. shipping_orders.qr_print_flag を更新
 *  2. order_audit_logs に action='qr_flag_change' で記録（before/after を diff に）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  qr_print_flag: z.boolean(),
});

export async function PUT(
  req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const json = await req.json();
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
    select: { id: true, pkNo: true, qrPrintFlag: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: `ピッキング№が見つかりません: ${pkNo}` },
      { status: 404 },
    );
  }

  const before = order.qrPrintFlag;
  const after = parsed.data.qr_print_flag;
  if (before === after) {
    return NextResponse.json({ data: { pkNo, qrPrintFlag: after }, message: 'NO_CHANGE' });
  }

  // 監査ログには staffCode（PC/モバイル両系統）。null の場合は監査トレースが不完全になるが、
  // システムアカウント等の例外運用を踏まえ admin/manager で staffCode 未設定でも進める。
  const staffCode = guard.auth.staffCode;
  if (!staffCode) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '監査ログ書込のため staffCode が必要です' },
      { status: 403 },
    );
  }

  await prisma.$transaction([
    prisma.shippingOrder.update({
      where: { id: order.id },
      data: { qrPrintFlag: after },
    }),
    prisma.orderAuditLog.create({
      data: {
        orderId: order.id,
        pkNo: order.pkNo,
        action: 'qr_flag_change',
        actedBy: staffCode,
        diff: { before: { qrPrintFlag: before }, after: { qrPrintFlag: after } },
      },
    }),
  ]);

  return NextResponse.json({ data: { pkNo, qrPrintFlag: after }, message: 'OK' });
}
