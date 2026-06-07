/**
 * 検品完了 / 手動 / 再印刷 から共通的に呼び出される印刷ジョブ実行ヘルパー。
 *
 * 役割:
 *  1. 端末（device_code）から既定プリンターを解決
 *  2. send → print_logs に成功/失敗を記録
 */

import { prisma } from './db';
import { sendPrintJob } from './print-client';

interface RunArgs {
  orderId: string;
  pkNo: string;
  invoiceNo: string | null;
  deviceCode: string;
  staffCode: string | null;
  isReprint: boolean;
  /** QR印刷フラグ OFF 伝票への強制印刷だった場合 true。ログに [FORCE] 接頭辞を付与。 */
  forcePrint?: boolean;
  /** 再印刷理由（任意）。ログに [reason:xxx] として付記。 */
  reason?: string;
}

export async function runPrintJob(args: RunArgs) {
  // 監査ログの接頭辞を組み立てる（runMode / forcePrint / reason）
  const tags: string[] = [];
  if (args.forcePrint) tags.push('FORCE');
  if (args.reason) tags.push(`reason:${args.reason}`);
  const tagPrefix = tags.length > 0 ? `[${tags.join('|')}] ` : '';

  // 端末→プリンター解決
  const map = await prisma.devicePrinterMap.findUnique({
    where: { deviceCode: args.deviceCode },
    include: { printer: { select: { code: true, ipAddress: true, port: true } } },
  });
  if (!map) {
    const log = await prisma.printLog.create({
      data: {
        orderId: args.orderId,
        pkNo: args.pkNo,
        invoiceNo: args.invoiceNo,
        printerCode: 'UNKNOWN',
        deviceCode: args.deviceCode,
        staffCode: args.staffCode,
        isReprint: args.isReprint,
        status: 'failed',
        errorMsg: `${tagPrefix}端末 ${args.deviceCode} に既定プリンターが紐付いていません`,
      },
    });
    return { ok: false as const, log };
  }

  const result = await sendPrintJob({
    invoiceNo: args.invoiceNo ?? args.pkNo,
    pkNo: args.pkNo,
    printerHost: map.printer.ipAddress,
    printerPort: map.printer.port,
  });

  // 切り分け診断のため、dryRun の状態を error_msg に併記する（運用ログ）
  //   2026-05-19: 「印刷できない」原因が DRY-RUN か実送信失敗かを DB だけで判別できるようにする。
  const diagPrefix = result.dryRun ? '[DRY-RUN] ' : '[LIVE] ';
  const errorMsgWithDiag =
    result.errorMsg != null
      ? `${tagPrefix}${diagPrefix}${result.errorMsg}`
      : `${tagPrefix}${diagPrefix}bytes=${result.bytesSent}`;

  const log = await prisma.printLog.create({
    data: {
      orderId: args.orderId,
      pkNo: args.pkNo,
      invoiceNo: args.invoiceNo,
      printerCode: map.printer.code,
      deviceCode: args.deviceCode,
      staffCode: args.staffCode,
      isReprint: args.isReprint,
      status: result.status,
      errorMsg: errorMsgWithDiag,
    },
  });

  return { ok: result.status === 'success', log, dryRun: result.dryRun };
}
