/**
 * JAN軸統合マスタ取込（2026-06-22）。「…構成商品JAN軸.csv」→ Product を補強。
 * - 見出し2行目：col0=構成商品コード(=Product.code) / col4=JANコード / col23=商品番号(=catalogNo)
 * - catalogNo を設定（構成商品サイズ一覧との突合キー）。
 * - jan は空のときだけ check-digit 検証して補完（既存値は壊さない）。
 * - Product に存在しない構成商品コードは未結合として記録。
 */

import { prisma } from '@/lib/db';
import { readCsvRows } from './read-csv';
import { validateJan } from '@/lib/jan-validator';
import type { ImportReport } from './report';

export async function importJanBridge(buf: Buffer, filename: string): Promise<ImportReport> {
  const rows = readCsvRows(buf);
  const report: ImportReport = {
    fileType: 'jan_bridge',
    filename,
    totalRows: 0,
    imported: 0,
    skipped: 0,
    unmatched: 0,
    warnings: [],
    unmatchedRows: [],
  };

  // 既存 Product を一括ロード（code → 現在のjan）
  const products = await prisma.product.findMany({ select: { code: true, jan: true } });
  const janByCode = new Map(products.map((p) => [p.code, p.jan]));

  // 見出し2行目 → データは index 2 以降
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const code = (r[0] ?? '').trim();
    if (!code) {
      report.skipped++;
      continue;
    }
    report.totalRows++;
    if (!janByCode.has(code)) {
      report.unmatched++;
      report.unmatchedRows.push({
        構成商品コード: code,
        構成商品名: (r[1] ?? '').trim(),
        JANコード: (r[4] ?? '').trim(),
        商品番号: (r[23] ?? '').trim(),
        理由: 'WMS Product に未登録',
      });
      continue;
    }
    const hinban = (r[23] ?? '').trim();
    const data: { catalogNo?: string; jan?: string } = {};
    if (hinban) data.catalogNo = hinban.slice(0, 30);
    // jan は空のときだけ補完
    if (!janByCode.get(code)) {
      const v = validateJan((r[4] ?? '').trim());
      if (v.isValid && v.normalized) data.jan = v.normalized;
    }
    if (Object.keys(data).length === 0) {
      report.skipped++;
      continue;
    }
    await prisma.product.update({ where: { code }, data });
    report.imported++;
  }
  return report;
}
