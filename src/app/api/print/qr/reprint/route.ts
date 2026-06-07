/**
 * POST /api/print/qr/reprint
 * QR再印刷（ラベル破損等のため）
 *
 * リクエスト: { pkNo, deviceCode?, reason? }
 * is_reprint=true で print_logs に記録。
 *
 * 2026-05-22:
 *   このエンドポイントは「ラベル破損による再印刷」と
 *   「QR印刷フラグ OFF 伝票への強制印刷」の両用途を兼ねる。
 *   UI 側（ReprintModal）は元から OFF 伝票で警告表示しつつ印字する設計のため、
 *   ここで QR フラグ OFF を弾かない。
 *   ※ 強制印刷の事実は print_logs.is_reprint=true で残るほか、
 *      errorMsg 接頭辞 [FORCE] で識別可能にする。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { runPrintJob } from '@/lib/print-job';

const Body = z.object({
  pkNo: z.string().min(1),
  deviceCode: z.string().min(1).optional(),
  // reason は監査用。UI からは未送信のケースもあるため optional とし、
  // 受領した値は print_logs に [reason:xxx] として残す。
  reason: z.string().optional(),
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

  // QR印刷フラグ OFF でも「任意（強制）印刷」を許可する。
  // ラベル破損ケースに加え、フラグ漏れ伝票への現場対応をカバーする。
  const isForce = !order.qrPrintFlag;

  const result = await runPrintJob({
    orderId: order.id,
    pkNo: order.pkNo,
    invoiceNo: order.invoiceNo,
    deviceCode,
    staffCode: guard.auth.staffCode,
    isReprint: true,
    forcePrint: isForce,
    reason: parsed.data.reason,
  });

  return NextResponse.json({
    data: {
      ok: result.ok,
      dryRun: 'dryRun' in result ? result.dryRun : false,
      forcePrint: isForce,
    },
    message: result.ok ? 'OK' : 'PRINT_FAILED',
  });
}
