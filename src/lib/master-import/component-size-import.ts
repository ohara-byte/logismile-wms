/**
 * 構成商品サイズ取込（2026-06-22）。構成商品サイズ一覧.xlsx → ProductAuxAttr(w/d/h mm)。
 *
 * 2モード（filename 拡張子で自動判定）:
 *  - xlsx（初回）：sheet1 col3=商品番号 / col6=箱サイズ「横×縦×高さ」cm。
 *      Product.catalogNo（JAN軸取込で設定済）と突合 → 寸法を登録。未結合は突合レポートへ。
 *  - csv（再UL・割当て済み）：DLした未結合CSVに「WMS商品コード」を記入して再取込。
 *      明示マッピングで寸法を登録し、Product.catalogNo も補完（次回xlsxで自動結合）。
 *
 * cm→mm（×10・四捨五入）。内寸計算は box-selector が商品容積×1.2 で吸収。
 */

import { prisma } from '@/lib/db';
import { readXlsxSheet } from './xlsx-lite';
import { readCsvRows } from './read-csv';
import type { ImportReport } from './report';

/** 「9.5×19.0×1.3」→ {w,d,h}(mm)。区切りは ×/x/✕/, に対応。 */
function parseSizeCm(raw: string): { w: number; d: number; h: number } | null {
  const parts = raw
    .trim()
    .split(/[×xX✕,]/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (parts.length < 3) return null;
  return {
    w: Math.round(parts[0] * 10),
    d: Math.round(parts[1] * 10),
    h: Math.round(parts[2] * 10),
  };
}

async function upsertAux(productCode: string, w: number, d: number, h: number): Promise<void> {
  await prisma.productAuxAttr.upsert({
    where: { productCode },
    create: { productCode, wMm: w, dMm: d, hMm: h },
    update: { wMm: w, dMm: d, hMm: h },
  });
}

export async function importComponentSizes(buf: Buffer, filename: string): Promise<ImportReport> {
  const isCsv = /\.csv$/i.test(filename);
  const report: ImportReport = {
    fileType: 'comp_size',
    filename,
    totalRows: 0,
    imported: 0,
    skipped: 0,
    unmatched: 0,
    warnings: [],
    unmatchedRows: [],
  };

  if (isCsv) {
    // ── 再UL（割当て済みCSV）── 見出し行からカラム位置を特定
    const rows = readCsvRows(buf);
    if (rows.length < 2) {
      report.warnings.push('CSVに行がありません');
      return report;
    }
    const header = rows[0].map((h) => h.trim());
    const idxHinban = header.findIndex((h) => /商品番号/.test(h));
    const idxSize = header.findIndex((h) => /箱サイズ|サイズ/.test(h));
    const idxCode = header.findIndex((h) => /WMS商品コード|商品コード|productCode/i.test(h));
    if (idxCode < 0 || idxSize < 0) {
      report.warnings.push('必要列（WMS商品コード / 箱サイズ）が見つかりません');
      return report;
    }
    const codes = new Set((await prisma.product.findMany({ select: { code: true } })).map((p) => p.code));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const code = (r[idxCode] ?? '').trim();
      const hinban = idxHinban >= 0 ? (r[idxHinban] ?? '').trim() : '';
      const size = parseSizeCm(r[idxSize] ?? '');
      if (!code) {
        report.skipped++;
        continue;
      }
      report.totalRows++;
      if (!codes.has(code)) {
        report.unmatched++;
        report.unmatchedRows.push({ WMS商品コード: code, 商品番号: hinban, 理由: 'Productに未登録' });
        continue;
      }
      if (!size) {
        report.unmatched++;
        report.unmatchedRows.push({ WMS商品コード: code, 商品番号: hinban, 理由: '箱サイズが不正' });
        continue;
      }
      await upsertAux(code, size.w, size.d, size.h);
      if (hinban) await prisma.product.update({ where: { code }, data: { catalogNo: hinban.slice(0, 30) } });
      report.imported++;
    }
    return report;
  }

  // ── 初回（xlsx）── catalogNo で突合
  const sheet = readXlsxSheet(buf, 1);
  const byCatalog = new Map<string, string[]>();
  for (const p of await prisma.product.findMany({
    where: { catalogNo: { not: null } },
    select: { code: true, catalogNo: true },
  })) {
    const key = (p.catalogNo ?? '').trim();
    if (!key) continue;
    (byCatalog.get(key) ?? byCatalog.set(key, []).get(key)!).push(p.code);
  }

  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i];
    const hinban = (r[3] ?? '').trim();
    const sizeRaw = (r[6] ?? '').trim();
    if (!hinban) {
      report.skipped++;
      continue;
    }
    report.totalRows++;
    const codes = byCatalog.get(hinban);
    if (!codes || codes.length === 0) {
      report.unmatched++;
      report.unmatchedRows.push({
        商品番号: hinban,
        商品名: (r[4] ?? '').trim(),
        箱サイズ: sizeRaw,
        WMS商品コード: '',
      });
      continue;
    }
    const size = parseSizeCm(sizeRaw);
    if (!size) {
      report.unmatched++;
      report.unmatchedRows.push({
        商品番号: hinban,
        商品名: (r[4] ?? '').trim(),
        箱サイズ: sizeRaw,
        WMS商品コード: codes.join(';'),
        理由: 'サイズ解析不可',
      });
      continue;
    }
    for (const code of codes) await upsertAux(code, size.w, size.d, size.h);
    report.imported++;
  }
  return report;
}
