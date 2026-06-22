/**
 * マスタ取込の共通レポート型・ユーティリティ（2026-06-22）。
 * 各取込は ImportReport を返し、API ルートが画面表示＋未結合CSVダウンロードに使う。
 */

import { prisma } from '@/lib/db';

export interface ImportReport {
  /** thomas_imports.file_type と同じ短いコード */
  fileType: string;
  filename: string;
  totalRows: number;
  /** 取込（作成＋更新）できた件数 */
  imported: number;
  /** 対象外でスキップした件数（合計行・空行など） */
  skipped: number;
  /** 突合できず未反映だった件数 */
  unmatched: number;
  warnings: string[];
  /** 未結合・要確認の行（CSVでダウンロードして人手補正に使う） */
  unmatchedRows: Record<string, string>[];
}

/** 未結合行を Excel で開ける CSV（UTF-8 BOM・CRLF）にする */
export function reconciliationCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v: string) =>
    /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h] ?? '')).join(','));
  return '﻿' + lines.join('\r\n');
}

/** thomas_imports に監査行を残す（失敗しても取込本体は止めない） */
export async function writeImportAudit(
  report: ImportReport,
  importedBy: string | null,
): Promise<void> {
  await prisma.thomasImport
    .create({
      data: {
        filename: report.filename.slice(0, 200),
        fileType: report.fileType.slice(0, 20),
        totalRows: report.totalRows,
        successCount: report.imported,
        errorCount: report.skipped,
        unmapCount: report.unmatched,
        importedBy,
        note: report.warnings.slice(0, 20).join(' / ').slice(0, 2000) || null,
      },
    })
    .catch(() => {});
}
