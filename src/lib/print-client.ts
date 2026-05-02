/**
 * SCeaTa CT4-LX プリンタークライアント
 *
 * 仕様（CLAUDE.md §6 より）：
 * - 用紙: SATO レスプリ・シータラベル 30×40mm
 * - 印字: QRコード（納品書№をエンコード）+ 納品書№テキスト
 *
 * 実装方針：
 * - 開発環境では実プリンターが無いので、TCP 送信を抑止して **DRY-RUN** を返す
 *   （`PRINTER_DRY_RUN=true` で明示。.env.local では既定 ON）
 * - 本番環境では SCeaTa の Raw 9100 ポートに ZPL/CUPS-RAW を送信する想定
 *   ここでは net.Socket を用いた最小限の送信のみ実装し、ZPL コマンド組み立ては
 *   Phase 6 の最終調整で精緻化する想定（要件定義書 §印刷制御 に準拠）。
 */

import net from 'node:net';

export interface PrintLabelInput {
  invoiceNo: string;
  pkNo: string;
  printerHost: string;
  printerPort: number;
  /** 任意のメタ（再印刷理由など）。print_logs.error_msg ではなくログ用。 */
  meta?: Record<string, unknown>;
}

export interface PrintLabelResult {
  status: 'success' | 'failed';
  errorMsg?: string;
  /** DRY-RUN モードで実際の送信が行われていない場合 true */
  dryRun: boolean;
  /** 送信したペイロードの長さ（bytes）。DRY-RUN でも生成は行う。 */
  bytesSent: number;
}

/** ZPL 風のラベル指示文字列を生成。実機向けは Phase 6 で実機テストして調整する。 */
export function buildLabelPayload(input: Pick<PrintLabelInput, 'invoiceNo' | 'pkNo'>): string {
  // 30x40mm のラベル想定。SATO の SBPL でも ZPL でもプリンター依存なので
  // ここではプレースホルダ（運用前に実機調整）。
  return [
    '^XA',
    '^MMT',
    '^PW240', // 30mm @ 8dpmm
    '^LL320', // 40mm @ 8dpmm
    '^LS0',
    `^FO20,40^BQN,2,5^FDLA,${input.invoiceNo}^FS`,
    `^FO20,220^A0N,24,24^FD${input.invoiceNo}^FS`,
    '^XZ',
    '',
  ].join('\n');
}

/** プリンター送信（DRY-RUN 既定）。 */
export async function sendPrintJob(input: PrintLabelInput): Promise<PrintLabelResult> {
  const payload = buildLabelPayload(input);
  const dryRun = process.env.PRINTER_DRY_RUN !== 'false';

  if (dryRun) {
    console.info(
      `[print-client] DRY-RUN → ${input.printerHost}:${input.printerPort} ` +
        `pkNo=${input.pkNo} invoice=${input.invoiceNo} bytes=${Buffer.byteLength(payload)}`,
    );
    return { status: 'success', dryRun: true, bytesSent: Buffer.byteLength(payload) };
  }

  return await new Promise<PrintLabelResult>((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (result: PrintLabelResult) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(result);
    };

    sock.setTimeout(5000);
    sock.once('error', (e) =>
      finish({ status: 'failed', errorMsg: e.message, dryRun: false, bytesSent: 0 }),
    );
    sock.once('timeout', () =>
      finish({ status: 'failed', errorMsg: 'TCP timeout', dryRun: false, bytesSent: 0 }),
    );

    sock.connect(input.printerPort, input.printerHost, () => {
      sock.end(payload, 'utf8', () => {
        finish({
          status: 'success',
          dryRun: false,
          bytesSent: Buffer.byteLength(payload),
        });
      });
    });
  });
}
