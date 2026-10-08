/**
 * Phase 2 — Thomas CSV 取込アダプタ
 *
 * 仕様：
 * - 文字コード Shift-JIS / UTF-8 自動判定
 * - JAN は形式検証のみ（重複は許容）
 * - ★ ピッキング№は重複時スキップ＋エラー報告
 * - ★ 「熨斗フラグ」→ qr_print_flag に読み替え
 * - 未マップ商品は alerts テーブルに登録
 */


import { parseCsv, detectFileType } from './csv-parser';
import { importOrderRows, importProductRows } from './thomas-import';
import type {
  IntegrationAdapter,
  ImportContext,
  ImportResult,
  ImportSource,
} from './types';


/**
 * CSV 取込のサイズ/行数上限（2026-06-01 バグレビュー C-2）。
 *   manager 限定の内部機能だが、巨大ファイルでのメモリ枯渇を防ぐガード。
 *   env で上書き可：THOMAS_CSV_MAX_BYTES / THOMAS_CSV_MAX_ROWS。
 */
const MAX_CSV_BYTES = parseInt(process.env.THOMAS_CSV_MAX_BYTES ?? '', 10) || 5 * 1024 * 1024; // 5MB
const MAX_CSV_ROWS = parseInt(process.env.THOMAS_CSV_MAX_ROWS ?? '', 10) || 20000; // 2万行

/** buffer のバイト数が上限を超えていないか検査（パース前）。 */
function assertCsvSize(buffer: Buffer): void {
  if (buffer.byteLength > MAX_CSV_BYTES) {
    throw new Error(
      `CSV ファイルが大きすぎます（${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB / 上限 ${(MAX_CSV_BYTES / 1024 / 1024).toFixed(0)}MB）。分割してアップロードしてください。`,
    );
  }
}

/** パース後の行数が上限を超えていないか検査。 */
function assertCsvRows(rowCount: number): void {
  if (rowCount > MAX_CSV_ROWS) {
    throw new Error(
      `CSV の行数が多すぎます（${rowCount} 行 / 上限 ${MAX_CSV_ROWS} 行）。分割してアップロードしてください。`,
    );
  }
}

/**
 * CSV を読んで種別を確かめ、登録処理（thomas-import.ts）へ渡す。
 * 登録の中身は HUB の API 取込と共通（2026-10-08 に分離）。
 */
export class CsvAdapter implements IntegrationAdapter {
  /** Thomas商品マスタ取込 → products を upsert。 */
  async importProducts(source: ImportSource, ctx: ImportContext): Promise<ImportResult> {
    if (source.kind !== 'csv') {
      throw new Error('CsvAdapter は kind=csv の ImportSource のみ受け付けます');
    }

    assertCsvSize(source.buffer);
    const { rows, headers } = parseCsv<Record<string, string>>(source.buffer);
    assertCsvRows(rows.length);
    const fileType = detectFileType(headers);
    if (fileType !== 'products') {
      throw new Error(
        `CSV の種別が products と判定できません（検出=${fileType}）。商品マスタ用CSVをアップロードしてください。`,
      );
    }

    return importProductRows(rows, { filename: source.filename, importedBy: ctx.importedBy });
  }

  /** Thomas出荷指示取込 → shipping_orders + shipping_order_items を作成。 */
  async importShippingOrders(source: ImportSource, ctx: ImportContext): Promise<ImportResult> {
    if (source.kind !== 'csv') {
      throw new Error('CsvAdapter は kind=csv の ImportSource のみ受け付けます');
    }

    assertCsvSize(source.buffer);
    const { rows, headers } = parseCsv<Record<string, string>>(source.buffer);
    assertCsvRows(rows.length);
    const fileType = detectFileType(headers);
    if (fileType !== 'orders') {
      throw new Error(
        `CSV の種別が orders と判定できません（検出=${fileType}）。出荷指示用CSVをアップロードしてください。`,
      );
    }

    return importOrderRows(rows, { filename: source.filename, importedBy: ctx.importedBy });
  }
}
