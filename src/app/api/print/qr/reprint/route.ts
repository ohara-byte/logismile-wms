/**
 * POST /api/print/qr/reprint
 * QR再印刷（ラベル破損等のため）
 *
 * リクエスト: { pkNo, deviceCode, reason }
 * is_reprint=true で print_logs に記録。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { runPrintJob } from '@/lib/print-job';

const Body = z.object({
  pkNo: z.string().min(1),
  deviceCode: z.string().min(1).optional(),
  reason: z.string().min(1),
});

export async function POST(req: Request) {
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

  // モバイル経路は自セッションの deviceCode のみ
  const deviceCode =
    guard.auth.source === 'mobile' ? guard.auth.deviceCode : parsed.data.deviceCode;
  if (!deviceCode) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'deviceCode を解決できません（PC は Body で指定してください）' },
      { status: 422 },
    );
  }

  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo: parsed.data.pkNo, deletedAt: null },
    select: { id: true, pkNo: true, qrPrintFlag: true, invoiceNo: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'ピッキング№が見つかりません' },
      { status: 404 },
    );
  }
  if (!order.qrPrintFlag) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'QR印刷フラグが OFF のため再印刷できません' },
      { status: 422 },
    );
  }

  const result = await runPrintJob({
    orderId: order.id,
    pkNo: order.pkNo,
    invoiceNo: order.invoiceNo,
    deviceCode,
    staffCode: guard.auth.staffCode,
    isReprint: true,
  });

  // 再印刷の理由は print_logs.error_msg ではなく insp_log/別フィールドだが、
  // 現スキーマでは print_logs に reason 列がないため alerts には残さず log のみ。
  // 必要に応じて Phase 6 で print_logs にカラム追加を検討。
  void parsed.data.reason;

  return NextResponse.json({
    data: { ok: result.ok, dryRun: 'dryRun' in result ? result.dryRun : false },
    message: result.ok ? 'OK' : 'PRINT_FAILED',
  });
}
