/**
 * POST /api/inspect/complete
 * 検品完了（納品書№スキャン）
 *
 * リクエスト: { sessionId, pkNo, invoiceNo, boxCode? }
 *
 * 処理:
 *  1. ピッキング№と納品書№の整合性確認
 *  2. 全アイテムが scannedQty == qty (or forceOk) であることを確認
 *  3. shipping_orders.status='packed', invoice_no を更新
 *  4. insp_sessions.completed_at, duration_sec, box_code を記録
 *  5. insp_logs に type=complete 記録
 *  6. ★ qr_print_flag=true の場合のみ自動印刷
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { isAllInspected } from '@/lib/inspection';
import { runPrintJob } from '@/lib/print-job';

const Body = z.object({
  sessionId: z.string().min(1),
  pkNo: z.string().min(1),
  invoiceNo: z.string().min(1),
  boxCode: z.string().optional(),
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

  const session = await prisma.inspSession.findUnique({
    where: { id: parsed.data.sessionId },
    include: {
      order: {
        select: {
          id: true,
          pkNo: true,
          qrPrintFlag: true,
          status: true,
          items: { select: { qty: true, scannedQty: true, forceOk: true } },
        },
      },
    },
  });
  if (!session) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'セッションがありません' }, { status: 404 });
  }
  if (session.completedAt) {
    return NextResponse.json(
      { error: 'CONFLICT', message: 'セッションは既に完了しています' },
      { status: 409 },
    );
  }
  if (session.order.pkNo !== parsed.data.pkNo) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: `ピッキング№が一致しません（セッション=${session.order.pkNo}, 入力=${parsed.data.pkNo}）`,
      },
      { status: 422 },
    );
  }
  if (!isAllInspected(session.order.items)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'すべての商品が検品されていません（強制OK or スキャン）' },
      { status: 422 },
    );
  }

  const startedAt = session.startedAt;
  const completedAt = new Date();
  const durationSec = Math.max(1, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000));

  await prisma.$transaction([
    prisma.shippingOrder.update({
      where: { id: session.order.id },
      data: { status: 'packed', invoiceNo: parsed.data.invoiceNo },
    }),
    prisma.inspSession.update({
      where: { id: session.id },
      data: { completedAt, durationSec, boxCode: parsed.data.boxCode },
    }),
    prisma.inspLog.create({
      data: {
        sessionId: session.id,
        type: 'complete',
        itemCode: parsed.data.invoiceNo,
        note: parsed.data.boxCode ? `boxCode=${parsed.data.boxCode}` : null,
      },
    }),
  ]);

  // ★ QR印刷フラグ ON の場合のみ自動印刷
  let printResult: Awaited<ReturnType<typeof runPrintJob>> | null = null;
  if (session.order.qrPrintFlag) {
    if (!session.deviceCode) {
      // 端末コードがないと既定プリンター解決不可
      printResult = null;
    } else {
      printResult = await runPrintJob({
        orderId: session.order.id,
        pkNo: session.order.pkNo,
        invoiceNo: parsed.data.invoiceNo,
        deviceCode: session.deviceCode,
        staffCode: session.staffCode,
        isReprint: false,
      });
    }
  }

  return NextResponse.json({
    data: {
      sessionId: session.id,
      pkNo: session.order.pkNo,
      status: 'packed',
      invoiceNo: parsed.data.invoiceNo,
      durationSec,
      qrPrintFlag: session.order.qrPrintFlag,
      print: printResult ? { ok: printResult.ok, dryRun: printResult.dryRun ?? false } : null,
    },
    message: 'OK',
  });
}
