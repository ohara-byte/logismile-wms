/**
 * 箱マスタ取込（2026-06-22）。箱マスタ.xlsx → Box。
 * - sheet1（見出し4行目）：col1=WMS箱コード / col2=箱名称 / col3=田舎主義コード
 * - sheet2（見出し3行目）：col1=WMS箱コード / col7=サイズ区分 / col10=長さ col11=幅 col12=深さ(mm)
 * 内寸＝外寸（マージン見ない・確定2026-06-22）。frozen/noshi/priority/type は手動値を保持。
 */

import { prisma } from '@/lib/db';
import { readXlsxSheet } from './xlsx-lite';
import type { ImportReport } from './report';

function intOrNull(s: string | undefined): number | null {
  if (s == null || s.trim() === '') return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

interface Sheet2Dim {
  sizeRank: number | null;
  l: number | null;
  w: number | null;
  d: number | null;
  name: string;
}

export async function importBoxes(buf: Buffer, filename: string): Promise<ImportReport> {
  const sheet1 = readXlsxSheet(buf, 1);
  const sheet2 = readXlsxSheet(buf, 2);

  const dims = new Map<string, Sheet2Dim>();
  for (let i = 3; i < sheet2.length; i++) {
    const r = sheet2[i];
    const code = (r[1] ?? '').trim();
    if (!code || !/^\d/.test(code)) continue;
    dims.set(code, {
      sizeRank: intOrNull(r[7]),
      l: intOrNull(r[10]),
      w: intOrNull(r[11]),
      d: intOrNull(r[12]),
      name: (r[2] ?? '').trim(),
    });
  }

  const report: ImportReport = {
    fileType: 'box_master',
    filename,
    totalRows: 0,
    imported: 0,
    skipped: 0,
    unmatched: 0,
    warnings: [],
    unmatchedRows: [],
  };

  for (let i = 4; i < sheet1.length; i++) {
    const r = sheet1[i];
    const code = (r[1] ?? '').trim();
    const boxName = (r[2] ?? '').trim();
    const thomas = (r[3] ?? '').trim();
    if (!code || !/^\d/.test(code)) {
      report.skipped++;
      continue;
    }
    report.totalRows++;
    const d = dims.get(code);
    if (!d) {
      report.unmatched++;
      report.unmatchedRows.push({
        WMS箱コード: code,
        箱名称: boxName,
        田舎主義コード: thomas,
        理由: 'sheet2に寸法なし',
      });
      continue;
    }
    if (d.sizeRank == null) report.warnings.push(`サイズ区分なし: ${code} ${boxName}`);
    const sizeRank = d.sizeRank ?? 0;
    const wMm = d.l ?? 0;
    const dMm = d.w ?? 0;
    const hMm = d.d ?? 0;
    const name = boxName || d.name || code;
    await prisma.box.upsert({
      where: { code },
      create: {
        code,
        name,
        type: 'variable',
        sizeRank,
        wMm,
        dMm,
        hMm,
        innerWMm: wMm,
        innerDMm: dMm,
        innerHMm: hMm,
        thomasCode: thomas || null,
      },
      update: {
        name,
        sizeRank,
        wMm,
        dMm,
        hMm,
        innerWMm: wMm,
        innerDMm: dMm,
        innerHMm: hMm,
        thomasCode: thomas || null,
      },
    });
    report.imported++;
  }
  return report;
}
