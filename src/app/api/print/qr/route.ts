/**
 * POST /api/print/qr
 * QR印刷指示（手動）
 *
 * 権限: admin / manager / staff
 *
 * deviceCode の解決:
 *  - mobile セッション（タブレット/ハンディ）→ 自セッションの deviceCode を使用
 *    （Body の値は無視。他人のプリンターへ印刷指示できないようにする）
 *  - PC セッション（admin/manager）→ Body の deviceCode 必須
 *
 * 処理:
 *  1. shipping_orders.qr_print_flag = false なら 422
 *  2. device_printer_map から既定プリンターを取得 → ZPL 送信
 *  3. print_logs に記録
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { runPrintJob } from '@/lib/print-job';

const Body = z.object({
  pkNo: z.string().min(1),
  deviceCode: z.string().min(1).optional(),
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

  // モバイル経路は自セッションの deviceCode のみ。PC は Body 必須。
  const deviceCode =
    guard.auth.source === 'mobile'
      ? guard.auth.deviceCode
      : parsed.data.deviceCode;
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
      { error: 'VALIDATION', message: 'QR印刷フラグが OFF のため印刷できません（先にフラグを切替えてください）' },
      { status: 422 },
    );
  }

  const result = await runPrintJob({
    orderId: order.id,
    pkNo: order.pkNo,
    invoiceNo: order.invoiceNo,
    deviceCode,
    staffCode: guard.auth.staffCode,
    isReprint: false,
  });

  return NextResponse.json({
    data: { ok: result.ok, dryRun: 'dryRun' in result ? result.dryRun : false },
    message: result.ok ? 'OK' : 'PRINT_FAILED',
  });
}
