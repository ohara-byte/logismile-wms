/**
 * GP シフト CSV 取込ロジック
 *
 * GPシフトCSV のフォーマット（実機サンプルなし → 推定）:
 *  - 1 列目: 社員番号（emp_code に一致）
 *  - 2 列目: 氏名（参考表示用）
 *  - 3 列目以降: 日付別のパターンコード（G7 / 公休 / 有休 等）
 *
 * 実装方針:
 *  - ヘッダ行から日付を自動検出（"YYYY/MM/DD" / "MM/DD" / "M/D" 等）
 *  - 1 行ずつ staff を `emp_code` で突合
 *  - 不明 emp_code は unmatchedEmpCodes に積む
 *  - 不明パターンコードはエラー
 */

import { parseCsv } from './integration/csv-parser';
import { prisma } from './db';

export interface ShiftPreview {
  totalRows: number;
  matched: number;
  matchedStaff: number;
  unmatchedEmpCodes: string[];
  unknownPatterns: string[];
  /** 集計：パターンごとの件数 */
  patternStats: Record<string, number>;
  /** 取込候補（execute で書き込み対象） */
  payload: Array<{
    date: string;
    staffCode: string;
    patternCode: string;
  }>;
}

const DATE_RE = /^\s*(\d{4})[/-]?(\d{1,2})[/-]?(\d{1,2})\s*$/;
const SHORT_DATE_RE = /^\s*(\d{1,2})[/-](\d{1,2})\s*$/;

/** ヘッダ列を YYYY-MM-DD に正規化。年が省略されている場合は yearHint を補う。 */
function normalizeHeaderDate(raw: string, yearHint: number): string | null {
  const long = raw.match(DATE_RE);
  if (long) {
    const y = Number(long[1]);
    const m = String(Number(long[2])).padStart(2, '0');
    const d = String(Number(long[3])).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const short = raw.match(SHORT_DATE_RE);
  if (short) {
    const m = String(Number(short[1])).padStart(2, '0');
    const d = String(Number(short[2])).padStart(2, '0');
    return `${yearHint}-${m}-${d}`;
  }
  return null;
}

export async function previewShiftCsv(buffer: Buffer): Promise<ShiftPreview> {
  // raw rows としてパース（ヘッダなし扱いだと PapaParse 設定が合わないので、
  //  parseCsv は header:true なので使わず、自前で行配列に分解する）
  const text = parseCsv<Record<string, string>>(buffer);
  const headers = text.headers;
  const rows = text.rows;

  const yearHint = new Date().getFullYear();
  // ヘッダから日付列を抽出
  const dateCols: { header: string; date: string }[] = [];
  for (const h of headers) {
    const norm = normalizeHeaderDate(h, yearHint);
    if (norm) dateCols.push({ header: h, date: norm });
  }

  if (dateCols.length === 0) {
    throw new Error('CSV から日付列が検出できませんでした（ヘッダに YYYY/MM/DD or MM/DD が必要）');
  }

  // emp_code は 1 列目（headers[0]）
  const empCol = headers[0];

  // staff マスタを emp_code でロード
  const allStaff = await prisma.staff.findMany({
    select: { code: true, empCode: true, name: true, active: true },
  });
  const staffByEmp = new Map(allStaff.map((s) => [s.empCode, s]));

  // shift_patterns マスタ
  const patterns = await prisma.shiftPattern.findMany({ select: { code: true } });
  const patternSet = new Set(patterns.map((p) => p.code));

  const unmatched = new Set<string>();
  const unknownPatterns = new Set<string>();
  const patternStats: Record<string, number> = {};
  const payload: ShiftPreview['payload'] = [];
  let matched = 0;
  const matchedStaffSet = new Set<string>();

  for (const row of rows) {
    const empCode = (row[empCol] ?? '').trim();
    if (!empCode) continue;
    const staff = staffByEmp.get(empCode);
    if (!staff) {
      unmatched.add(empCode);
      continue;
    }
    matchedStaffSet.add(staff.code);

    for (const dc of dateCols) {
      const cell = (row[dc.header] ?? '').trim();
      if (!cell) continue;
      if (!patternSet.has(cell)) {
        unknownPatterns.add(cell);
        continue;
      }
      patternStats[cell] = (patternStats[cell] ?? 0) + 1;
      payload.push({ date: dc.date, staffCode: staff.code, patternCode: cell });
      matched++;
    }
  }

  return {
    totalRows: rows.length * dateCols.length,
    matched,
    matchedStaff: matchedStaffSet.size,
    unmatchedEmpCodes: Array.from(unmatched),
    unknownPatterns: Array.from(unknownPatterns),
    patternStats,
    payload,
  };
}

export async function executeShiftImport(payload: ShiftPreview['payload']): Promise<{
  inserted: number;
}> {
  let inserted = 0;
  for (const p of payload) {
    await prisma.shift.upsert({
      where: { date_staffCode: { date: new Date(p.date), staffCode: p.staffCode } },
      update: { patternCode: p.patternCode, source: 'gp_csv', importedAt: new Date() },
      create: {
        date: new Date(p.date),
        staffCode: p.staffCode,
        patternCode: p.patternCode,
        source: 'gp_csv',
        importedAt: new Date(),
      },
    });
    inserted++;
  }
  return { inserted };
}
