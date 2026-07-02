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

import { prisma } from '../db';
import { validateJan } from '../jan-validator';
import { parseCsv, detectFileType } from './csv-parser';
import {
  PRODUCT_CSV_COLUMNS as P,
  ORDER_CSV_COLUMNS as O,
  CARRIER_NAME_TO_CODE,
  parseQrPrintFlag,
} from './mapping';
import type {
  IntegrationAdapter,
  ImportContext,
  ImportResult,
  ImportRowError,
  ImportRowWarning,
  ImportSource,
} from './types';

const DEFAULT_CARRIER_CODE = 'YMT-N';

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

    const errors: ImportRowError[] = [];
    const warnings: ImportRowWarning[] = [];
    let janErrorCount = 0;
    let janWarnCount = 0;
    let successCount = 0;

    // 取込履歴を先に作成（途中失敗でも履歴を残す）
    const importLog = await prisma.thomasImport.create({
      data: {
        filename: source.filename,
        fileType: 'products',
        totalRows: rows.length,
        importedBy: ctx.importedBy,
      },
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const code = (row[P.CODE] ?? '').trim();
      const name = (row[P.NAME] ?? '').trim();
      const janRaw = (row[P.JAN] ?? '').trim();

      if (!code) {
        errors.push({
          rowIndex: i + 1,
          reason: 'validation_error',
          message: '商品コードが空欄です',
        });
        continue;
      }
      if (!name) {
        errors.push({
          rowIndex: i + 1,
          productCode: code,
          reason: 'validation_error',
          message: '商品名が空欄です',
        });
        continue;
      }

      // JAN 検証（空欄は許容＝null として保存。形式不正はエラー扱い）
      // 2026-05-30: 12 桁は警告扱い（取込許可・検品可・後日修正対象）
      let normalizedJan: string | null = null;
      if (janRaw !== '') {
        const result = validateJan(janRaw);
        if (result.severity === 'warn') {
          // 12 桁 JAN など。JAN は格納し、警告として記録
          normalizedJan = result.normalized!;
          janWarnCount++;
          warnings.push({
            rowIndex: i + 1,
            productCode: code,
            reason: 'jan_12_digit',
            message: result.message ?? 'JAN 警告（後日修正対象）',
          });
        } else if (!result.isValid) {
          // エラー扱い：JAN は null で保存
          janErrorCount++;
          errors.push({
            rowIndex: i + 1,
            productCode: code,
            reason:
              result.code === 'invalid_length'
                ? 'jan_invalid_length'
                : result.code === 'non_digit'
                  ? 'jan_non_digit'
                  : result.code === 'invalid_check_digit'
                    ? 'jan_invalid_check_digit'
                    : 'jan_empty',
            message: result.message ?? 'JAN 検証エラー',
          });
          // JAN エラーでも商品自体は登録する（運用ポリシー: アラート対応）
        } else {
          normalizedJan = result.normalized!;
        }
      }

      try {
        await prisma.product.upsert({
          where: { code },
          update: {
            name,
            jan: normalizedJan,
            updatedAt: new Date(),
            // Sprint Y-13: 既存商品の productType は変更しない（手動編集を尊重）
          },
          create: {
            code,
            name,
            jan: normalizedJan,
            cat: inferCategory(code),
            active: true,
            // Sprint Y-13: 大江ノ郷の基本運用は通過型のため明示的に指定
            //   （DB 既定値が変わっていない環境でも確実に pass_through で作る）
            productType: 'pass_through',
          },
        });
        successCount++;
      } catch (e) {
        console.error('[csv-adapter products row]', { rowIndex: i + 1, code }, e);
        errors.push({
          rowIndex: i + 1,
          productCode: code,
          reason: 'parse_error',
          message: 'DB書込失敗（詳細はサーバログ）',
        });
      }
    }

    // JAN 不備ごとにアラートを登録
    for (const err of errors) {
      if (err.reason.startsWith('jan_')) {
        await prisma.alert.create({
          data: {
            type: 'jan_error',
            severity: 'warn',
            title: `JAN 形式不正: ${err.productCode ?? '(unknown)'}`,
            body: err.message,
            refCode: err.productCode,
          },
        });
      }
    }

    // 2026-05-30: JAN 警告（12 桁等）もアラートとして登録（後日修正対象）
    for (const w of warnings) {
      await prisma.alert.create({
        data: {
          type: 'jan_error',
          severity: 'warn',
          title: `JAN 警告（要修正）: ${w.productCode ?? '(unknown)'}`,
          body: w.message,
          refCode: w.productCode,
        },
      });
    }

    const updated = await prisma.thomasImport.update({
      where: { id: importLog.id },
      data: {
        successCount,
        errorCount: errors.length,
        janErrorCount,
        unmapCount: 0,
      },
    });

    return {
      importId: updated.id,
      fileType: 'products',
      filename: source.filename,
      totalRows: rows.length,
      successCount,
      errorCount: errors.length,
      janErrorCount,
      janWarnCount,
      duplicatePkNoCount: 0,
      unmapCount: 0,
      unmappedCodes: [],
      errors,
      warnings,
    };
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

    // 取込履歴を先に作成
    const importLog = await prisma.thomasImport.create({
      data: {
        filename: source.filename,
        fileType: 'orders',
        totalRows: rows.length,
        importedBy: ctx.importedBy,
      },
    });

    // 2026-06-02: 便種名 → carrier_code の対応を DB マスタ（carrier_aliases）から取得。
    //   DB に無い便種は従来のハードコード表（CARRIER_NAME_TO_CODE）→ DEFAULT の順でフォールバック。
    const aliasRows = await prisma.carrierAlias.findMany({
      where: { active: true },
      select: { aliasName: true, carrierCode: true },
    });
    const carrierAliasMap = new Map<string, string>(
      aliasRows.map((a) => [a.aliasName, a.carrierCode]),
    );
    const resolveCarrierCode = (carrierName: string): string =>
      carrierAliasMap.get(carrierName) ??
      CARRIER_NAME_TO_CODE[carrierName] ??
      DEFAULT_CARRIER_CODE;

    // 2026-06-02: QR印刷 強制マスタ（完全一致）。QRフラグ OFF でも noshiName/noshiPerson が
    //   登録テキストと完全一致したら QR ON で取り込む（例『特殊包装』）。
    const qrForceRows = await prisma.qrForceKeyword.findMany({
      where: { active: true },
      select: { matchText: true },
    });
    const qrForceSet = new Set(qrForceRows.map((r) => r.matchText));
    // 2026-06-03 現場要望: 照合対象は熨斗名称のみ（熨斗氏名は対象外）。
    const shouldForceQr = (noshiName?: string): boolean => {
      if (qrForceSet.size === 0) return false;
      const n = (noshiName ?? '').trim();
      return !!n && qrForceSet.has(n);
    };

    const errors: ImportRowError[] = [];
    const unmappedCodesSet = new Set<string>();
    let duplicatePkNoCount = 0;

    // ① ピッキング№でグルーピング（1 PkNo に複数明細）
    type Header = {
      pkNo: string;
      shipDate: Date;
      carrierCode: string;
      qrPrintFlag: boolean;
      noshiName?: string;
      noshiPerson?: string;
      destZip?: string;
      destAddr?: string;
      destName?: string;
      invoiceNo?: string;
      customerCode?: string;
      orderNo?: string;
    };
    const groups = new Map<
      string,
      {
        header: Header;
        items: { productCode: string; productName: string; qty: number; sortOrder: number; rowIndex: number }[];
      }
    >();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const pkNo = (row[O.PK_NO] ?? '').trim();
      if (!pkNo) {
        errors.push({
          rowIndex: i + 1,
          reason: 'validation_error',
          message: 'ピッキングNo が空欄です',
        });
        continue;
      }

      const productCode = (row[O.PRODUCT_CODE] ?? '').trim();
      const productName = (row[O.PRODUCT_NAME] ?? '').trim();
      const qty = parseInt((row[O.QTY] ?? '0').trim(), 10) || 0;
      if (!productCode) {
        errors.push({
          rowIndex: i + 1,
          pkNo,
          reason: 'validation_error',
          message: '商品コードが空欄です',
        });
        continue;
      }

      let group = groups.get(pkNo);
      if (!group) {
        const carrierName = (row[O.CARRIER] ?? '').trim();
        const carrierCode = resolveCarrierCode(carrierName);
        const shipDateRaw = (row[O.SHIP_DATE] ?? '').trim();
        const shipDate = parseShipDate(shipDateRaw);
        if (!shipDate) {
          errors.push({
            rowIndex: i + 1,
            pkNo,
            reason: 'validation_error',
            message: `出荷予定日が不正: ${shipDateRaw}`,
          });
          continue;
        }
        const noshiName = row[O.NOSHI_NAME]?.trim() || undefined;
        const noshiPerson = row[O.NOSHI_PERSON]?.trim() || undefined;
        // 基幹「熨斗フラグ」を基準に、QR強制マスタ一致時は ON へ昇格。
        const qrPrintFlag =
          parseQrPrintFlag(row[O.QR_PRINT_FLAG]) || shouldForceQr(noshiName);
        group = {
          header: {
            pkNo,
            shipDate,
            carrierCode,
            qrPrintFlag,
            noshiName,
            noshiPerson,
            destZip: row[O.DEST_ZIP]?.trim() || undefined,
            destAddr: row[O.DEST_ADDR]?.trim() || undefined,
            destName: row[O.DEST_NAME]?.trim() || undefined,
            invoiceNo: row[O.INVOICE_NO]?.trim() || undefined,
            // B・2026-06-12：基幹CSVの顧客コード(M列)・注文番号(N列)を取込（本部連絡の識別子）
            customerCode: row[O.CUSTOMER_CODE]?.trim() || undefined,
            orderNo: row[O.ORDER_NO]?.trim() || undefined,
          },
          items: [],
        };
        groups.set(pkNo, group);
      }

      group.items.push({
        productCode,
        productName,
        qty,
        sortOrder: group.items.length,
        rowIndex: i + 1,
      });
    }

    // ② 商品マスタを一括取得して未マップ判定
    const allProductCodes = new Set<string>();
    Array.from(groups.values()).forEach((g) =>
      g.items.forEach((it) => allProductCodes.add(it.productCode)),
    );

    const existingProducts = await prisma.product.findMany({
      where: { code: { in: Array.from(allProductCodes) } },
      select: { code: true, name: true },
    });
    const existingProductCodes = new Set(existingProducts.map((p) => p.code));

    // ③ 既存ピッキング№（DB上）を一括取得して重複検出
    const existingOrders = await prisma.shippingOrder.findMany({
      where: { pkNo: { in: Array.from(groups.keys()) } },
      select: { pkNo: true },
    });
    const existingPkNoSet = new Set(existingOrders.map((o) => o.pkNo));

    let successCount = 0;

    // ④ 各ピッキング№について書き込み
    for (const [pkNo, group] of Array.from(groups.entries())) {
      if (existingPkNoSet.has(pkNo)) {
        duplicatePkNoCount++;
        errors.push({
          rowIndex: group.items[0]?.rowIndex ?? 0,
          pkNo,
          reason: 'duplicate_pk_no',
          message: `ピッキング№が重複しています（既存伝票あり）: ${pkNo}`,
        });
        await prisma.alert.create({
          data: {
            type: 'duplicate_pkno',
            severity: 'error',
            title: `ピッキング№重複: ${pkNo}`,
            body: '基幹側で同一PkNoが2回以上送られた可能性があります。新PkNo発行を依頼してください。',
            refCode: pkNo,
          },
        });
        continue;
      }

      // 全アイテムが存在する商品か確認
      const missing = group.items.filter((it) => !existingProductCodes.has(it.productCode));
      missing.forEach((it) => {
        unmappedCodesSet.add(it.productCode);
        errors.push({
          rowIndex: it.rowIndex,
          pkNo,
          productCode: it.productCode,
          reason: 'product_not_found',
          message: `商品コードがマスタに未登録: ${it.productCode}`,
        });
      });
      if (missing.length > 0) {
        // 未マップ伝票はスキップ（マスタ補完後に再取込）
        continue;
      }

      try {
        await prisma.shippingOrder.create({
          data: {
            pkNo,
            importId: importLog.id,
            shipDate: group.header.shipDate,
            carrierCode: group.header.carrierCode,
            status: 'pending',
            qrPrintFlag: group.header.qrPrintFlag,
            noshiName: group.header.noshiName,
            noshiPerson: group.header.noshiPerson,
            destZip: group.header.destZip,
            destAddr: group.header.destAddr,
            destName: group.header.destName,
            invoiceNo: group.header.invoiceNo,
            customerCode: group.header.customerCode,
            orderNo: group.header.orderNo,
            items: {
              create: group.items.map((it) => ({
                productCode: it.productCode,
                productName: it.productName,
                qty: it.qty,
                sortOrder: it.sortOrder,
              })),
            },
          },
        });
        successCount++;
      } catch (e) {
        console.error('[csv-adapter orders row]', { pkNo }, e);
        errors.push({
          rowIndex: group.items[0]?.rowIndex ?? 0,
          pkNo,
          reason: 'parse_error',
          message: 'DB書込失敗（詳細はサーバログ）',
        });
      }
    }

    // ⑤ 未マップ商品コードごとにアラート登録（重複防止: refCode で upsert 風に）
    for (const code of Array.from(unmappedCodesSet)) {
      const exists = await prisma.alert.findFirst({
        where: { type: 'unmap_product', refCode: code, resolved: false },
        select: { id: true },
      });
      if (!exists) {
        await prisma.alert.create({
          data: {
            type: 'unmap_product',
            severity: 'warn',
            title: `未マップ商品: ${code}`,
            body: '商品マスタに未登録の商品コードを含む出荷指示があります。',
            refCode: code,
          },
        });
      }
    }

    const updated = await prisma.thomasImport.update({
      where: { id: importLog.id },
      data: {
        successCount,
        errorCount: errors.length,
        janErrorCount: 0,
        unmapCount: unmappedCodesSet.size,
      },
    });

    return {
      importId: updated.id,
      fileType: 'orders',
      filename: source.filename,
      totalRows: rows.length,
      successCount,
      errorCount: errors.length,
      janErrorCount: 0,
      duplicatePkNoCount,
      unmapCount: unmappedCodesSet.size,
      unmappedCodes: Array.from(unmappedCodesSet),
      errors,
    };
  }
}

/** Thomas の出荷予定日（"2026/04/20" 形式）を Date に変換。 */
function parseShipDate(raw: string): Date | null {
  if (!raw) return null;
  // "2026/04/20" / "2026-04-20" / "2026.04.20" を許容
  const m = raw.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  // @db.Date は「暦日」。UTC 0時で生成する（`new Date(y,mo,d)` はコンテナTZ=JSTのローカル0時
  //   ＝前日15:00Z になり、Prisma が @db.Date を UTC 日付で保存するため 1 日前倒しになる不具合）。
  //   日付根治（2026-07-02）: 出荷予定日は暦日どおり保存する。
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (isNaN(date.getTime())) return null;
  return date;
}

/**
 * 商品コード接頭辞からカテゴリを推定（マスタ未登録時のフォールバック）。
 * 完全な分類は管理画面で手動補正する想定。
 */
function inferCategory(code: string): string {
  const prefix = code.slice(0, 2).toUpperCase();
  switch (prefix) {
    case 'E-':
    case 'EG':
      return 'egg';
    case 'SW':
      return 'sweet';
    case 'MT':
      return 'meat';
    case 'FZ':
      return 'frozen';
    case 'GF':
      return 'gift';
    case 'SU':
    case 'SP':
      return 'soup';
    default:
      return 'other';
  }
}
