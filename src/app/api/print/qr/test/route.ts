/**
 * POST /api/print/qr/test
 * QR ラベル印刷の試刷（プリンタ動作確認用）
 *
 * 権限: admin / manager
 *
 * Body:
 *   {
 *     printerCode: string,                 // 必須。プリンタマスタの code
 *     invoiceNo?: string,                  // 任意。省略時はテスト固定値
 *     pkNo?: string,                       // 任意。省略時はテスト固定値
 *   }
 *
 * 動作:
 *  - shipping_orders を経由しない（=フラグ判定もしない）
 *  - print_logs に isReprint=true / orderId=null（テスト印刷タグ）として記録
 *  - PRINTER_DRY_RUN=true（既定）ならば実機送信せず DRY-RUN 結果を返す
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { sendPrintJob } from '@/lib/print-client';

const Body = z.object({
  printerCode: z.string().min(1),
  invoiceNo: z.string().min(1).optional(),
  pkNo: z.string().min(1).optional(),
});

// QR には納品書№が入る。QRバージョン固定（PRINTER_QR_VERSION=1）でも収まるよう、
// 試刷の既定値は「数字10桁」（V1＋ECC=H の数字モード上限17桁内）に統一する。
const DEFAULT_TEST_INVOICE = '9999999999';
const DEFAULT_TEST_PKNO = '9999999999';

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: parsed.error.issues.map((i) => i.message).join(', '),
      },
      { status: 422 },
    );
  }

  const printer = await prisma.printer.findUnique({
    where: { code: parsed.data.printerCode },
  });
  if (!printer) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'プリンタが見つかりません' },
      { status: 404 },
    );
  }
  if (!printer.active) {
    return NextResponse.json(
      { error: 'CONFLICT', message: 'プリンタが無効化されています' },
      { status: 409 },
    );
  }

  const invoiceNo = parsed.data.invoiceNo ?? DEFAULT_TEST_INVOICE;
  const pkNo = parsed.data.pkNo ?? DEFAULT_TEST_PKNO;

  const startedAt = Date.now();
  const result = await sendPrintJob({
    invoiceNo,
    pkNo,
    printerHost: printer.ipAddress,
    printerPort: printer.port,
    meta: { test: true, requestedBy: guard.auth.staffCode ?? 'admin' },
  });
  const elapsedMs = Date.now() - startedAt;

  // print_logs.orderId は NOT NULL（ShippingOrder への FK）のため、
  // 試刷ログは別領域に保存しない（伝票一覧の履歴と混ざらないようにもしたい）。
  // 実機運用では PRINTER_DRY_RUN=false でこの API を叩き、`result` を直接画面確認する想定。
  console.info(
    `[print-test] printer=${printer.code} ip=${printer.ipAddress}:${printer.port} ` +
      `pkNo=${pkNo} invoice=${invoiceNo} status=${result.status} dryRun=${result.dryRun} ` +
      `bytes=${result.bytesSent} elapsed=${elapsedMs}ms by=${guard.auth.staffCode ?? 'admin'}`,
  );

  return NextResponse.json({
    data: {
      ok: result.status === 'success',
      dryRun: result.dryRun,
      bytesSent: result.bytesSent,
      elapsedMs,
      printer: {
        code: printer.code,
        name: printer.name,
        ipAddress: printer.ipAddress,
        port: printer.port,
        labelSize: printer.labelSize,
      },
      payload: { invoiceNo, pkNo },
    },
    message: result.status === 'success' ? 'OK' : 'PRINT_FAILED',
  });
}
