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
}

export async function runPrintJob(args: RunArgs) {
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
        errorMsg: `端末 ${args.deviceCode} に既定プリンターが紐付いていません`,
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
      errorMsg: result.errorMsg,
    },
  });

  return { ok: result.status === 'success', log, dryRun: result.dryRun };
}
