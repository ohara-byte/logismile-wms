/**
 * GP シフト CSV 取込ロジック（実機サンプル準拠 / 2026-05-04 改訂 v2）
 *
 * 実 CSV フォーマット（long 形式・1 行 = 1 担当者 × 1 日付）:
 *   所属名,雇用区分,従業員コード,名前,日時,パターン名
 *   GPまごころ梱包,正社員A,94,山根 康稔,2026/04/16(木),有休
 *
 * Sprint J-2 追加: 「未マッチ社員を自動登録」オプション。
 * 担当者マスタ（staff）に存在しない従業員コードを CSV の名前・雇用区分から自動作成する。
 */

import { parseCsv } from './integration/csv-parser';
import { prisma } from './db';

export interface UnmatchedStaff {
  empCode: string;
  name: string;
  employmentName: string | null;
  /** 期間内に出現した行数 */
  rowCount: number;
}

export interface ShiftPreview {
  totalRows: number;
  matched: number;
  matchedStaff: number;
  /** Sprint J-1: 未マッチ社員の詳細（自動登録 UI 用） */
  unmatchedDetails: UnmatchedStaff[];
  /** 後方互換: 文字列のみのリスト */
  unmatchedEmpCodes: string[];
  unknownPatterns: string[];
  patternStats: Record<string, number>;
  payload: Array<{
    date: string;
    staffCode: string;
    patternCode: string;
  }>;
  /** 自動登録時に新規作成される staff の生データ（empCode → 入力値） */
  autoCreatableStaff: Array<{
    empCode: string;
    name: string;
    employmentTypeCode: string | null;
  }>;
  /** 範囲（取込対象の最小日 / 最大日）— UI のヒント用 */
  dateRange: { from: string | null; to: string | null };
}

const FW_TO_HW_MAP: Record<string, string> = {
  Ａ: 'A', Ｂ: 'B', Ｃ: 'C', Ｄ: 'D', Ｅ: 'E', Ｆ: 'F', Ｇ: 'G', Ｈ: 'H',
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
};

/** パターン名の正規化 — 全角→半角・末尾の括弧説明除去 */
export function normalizePatternCode(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/[ＡＢＣＤＥＦＧＨ０-９]/g, (ch) => FW_TO_HW_MAP[ch] ?? ch);
  s = s.replace(/[（(].*[)）]\s*$/u, '');
  return s.trim();
}

/** "2026/04/16(木)" / "2026-04-16" / "4/16" 等 → YYYY-MM-DD */
export function normalizeDateCell(raw: string, yearHint: number): string | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/[（(][^)）]*[)）]/g, '').trim();
  const long = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (long) {
    const y = Number(long[1]);
    const m = String(Number(long[2])).padStart(2, '0');
    const d = String(Number(long[3])).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const short = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (short) {
    const m = String(Number(short[1])).padStart(2, '0');
    const d = String(Number(short[2])).padStart(2, '0');
    return `${yearHint}-${m}-${d}`;
  }
  return null;
}

/** 雇用区分名のゆらぎを正規化（全角数字・空白・「社員」サフィックスを除去）して
 *  既存マスタの name と突合する。 */
function normalizeEmploymentName(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/[０-９]/g, (ch) => FW_TO_HW_MAP[ch] ?? ch);
  s = s.replace(/\s+/g, '');
  return s;
}

/** 雇用区分マスタ name の同等比較用キー。
 *  例: `正社員8h` `正社員 ８` どちらも `正社員8` に揃える。 */
function makeEmploymentKey(name: string): string {
  return normalizeEmploymentName(name)
    .replace(/h$|時間$|社員$/u, '')
    .replace(/^正社員$/, '正社員A')
    .toLowerCase();
}

async function buildEmploymentMap(): Promise<Map<string, string>> {
  const types = await prisma.employmentType.findMany({
    select: { code: true, name: true },
  });
  // CSV の表記ゆれをいくつか手動で吸収する補助マッピング
  const aliases: Record<string, string> = {
    嘱託: 'shokutaku',
    短時間: 'short',
  };
  const map = new Map<string, string>();
  for (const t of types) {
    map.set(makeEmploymentKey(t.name), t.code);
  }
  for (const [k, v] of Object.entries(aliases)) {
    map.set(makeEmploymentKey(k), v);
  }
  return map;
}

/** 従業員コードから staff.code（PK）を生成する規則。
 *  英数字なら "S" + empCode、数字のみなら "S" + 4 桁ゼロ埋め、いずれも 10 桁以内に収める。 */
function deriveStaffCode(empCode: string): string {
  const trimmed = empCode.trim();
  if (/^\d+$/.test(trimmed)) {
    return `S${trimmed.padStart(4, '0')}`.slice(0, 10);
  }
  return `S${trimmed}`.slice(0, 10);
}

/**
 * Sprint Y-13: 社員番号の表記ゆれを吸収して照合キーを作る。
 *   - CSV 側「0094」と DB 側「94」を同一視するため、数値のみのコードは
 *     先頭ゼロを除去した値で比較する。
 *   - 英字混在（例: "A012"）はそのまま比較する。
 *   - 空白は trim、半角/全角の数字混在は半角に統一。
 */
function normalizeEmpCode(s: string): string {
  let t = (s ?? '').trim();
  if (!t) return '';
  // 全角数字 → 半角
  t = t.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  // 数字のみの場合は先頭ゼロを除去（"0094" → "94", "00" → "0"）
  if (/^\d+$/.test(t)) {
    return String(Number(t));
  }
  return t;
}

/** ヘッダから対象列を検出（部分一致） */
function findColumn(headers: string[], candidates: string[]): string | null {
  for (const cand of candidates) {
    const hit = headers.find((h) => h.includes(cand));
    if (hit) return hit;
  }
  return null;
}

export async function previewShiftCsv(buffer: Buffer): Promise<ShiftPreview> {
  const parsed = parseCsv<Record<string, string>>(buffer);
  const headers = parsed.headers;
  const rows = parsed.rows;

  const empCol = findColumn(headers, ['従業員コード', '社員番号', 'emp_code', 'empCode']);
  const dateCol = findColumn(headers, ['日時', '日付', 'date']);
  const patternCol = findColumn(headers, ['パターン名', 'パターンコード', 'pattern']);
  const nameCol = findColumn(headers, ['名前', '氏名', '担当者名', 'name']);
  const employmentCol = findColumn(headers, ['雇用区分', '区分']);

  if (!empCol || !dateCol || !patternCol) {
    const missing: string[] = [];
    if (!empCol) missing.push('従業員コード');
    if (!dateCol) missing.push('日時');
    if (!patternCol) missing.push('パターン名');
    throw new Error(
      `必須列が見つかりません: ${missing.join(' / ')}（検出されたヘッダ: ${headers.join(', ')}）`,
    );
  }

  const yearHint = new Date().getFullYear();

  const allStaff = await prisma.staff.findMany({
    select: { code: true, empCode: true },
  });
  // Sprint Y-13: 社員番号は数値正規化キーで照合（先頭ゼロ・全角数字の差異を吸収）
  //   この WMS では社員番号がユニークキー。雇用区分や氏名は変動するため照合に使わない。
  const staffByEmp = new Map(
    allStaff.map((s) => [normalizeEmpCode(s.empCode), s]),
  );

  const patterns = await prisma.shiftPattern.findMany({ select: { code: true } });
  const patternSet = new Set(patterns.map((p) => p.code));

  const employmentMap = await buildEmploymentMap();

  const unknownPatterns = new Set<string>();
  const patternStats: Record<string, number> = {};
  const payload: ShiftPreview['payload'] = [];
  const matchedStaffSet = new Set<string>();
  let matched = 0;

  // 未マッチ集計（empCode キー、name と employmentName と件数を保持）
  const unmatchedMap = new Map<string, UnmatchedStaff>();

  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const row of rows) {
    const empCode = (row[empCol] ?? '').trim();
    const dateRaw = (row[dateCol] ?? '').trim();
    const patternRaw = (row[patternCol] ?? '').trim();
    if (!empCode || !dateRaw || !patternRaw) continue;

    const date = normalizeDateCell(dateRaw, yearHint);
    if (!date) continue;
    const patternCode = normalizePatternCode(patternRaw);
    if (!patternCode) continue;

    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;

    // Sprint Y-13: 数値正規化キーで照合
    const normKey = normalizeEmpCode(empCode);
    const staff = staffByEmp.get(normKey);
    if (!staff) {
      // 未マッチ詳細を蓄積（empCode 表示は CSV の原型を維持）
      const name = nameCol ? (row[nameCol] ?? '').trim() : '';
      const employmentName = employmentCol ? (row[employmentCol] ?? '').trim() : '';
      const cur = unmatchedMap.get(empCode);
      if (cur) {
        cur.rowCount++;
      } else {
        unmatchedMap.set(empCode, {
          empCode,
          name: name || `(unknown ${empCode})`,
          employmentName: employmentName || null,
          rowCount: 1,
        });
      }
      continue;
    }
    if (!patternSet.has(patternCode)) {
      unknownPatterns.add(patternCode);
      continue;
    }

    matchedStaffSet.add(staff.code);
    patternStats[patternCode] = (patternStats[patternCode] ?? 0) + 1;
    payload.push({ date, staffCode: staff.code, patternCode });
    matched++;
  }

  // 自動登録候補（未マッチを staff レコード化したもの）
  const autoCreatableStaff = Array.from(unmatchedMap.values()).map((u) => ({
    empCode: u.empCode,
    name: u.name,
    employmentTypeCode:
      u.employmentName !== null
        ? employmentMap.get(makeEmploymentKey(u.employmentName)) ?? null
        : null,
  }));

  return {
    totalRows: rows.length,
    matched,
    matchedStaff: matchedStaffSet.size,
    unmatchedDetails: Array.from(unmatchedMap.values()),
    unmatchedEmpCodes: Array.from(unmatchedMap.keys()),
    unknownPatterns: Array.from(unknownPatterns),
    patternStats,
    payload,
    autoCreatableStaff,
    dateRange: { from: minDate, to: maxDate },
  };
}

export interface ExecuteOptions {
  /** Sprint J-2: 未マッチ社員を自動登録してから取込を実行する */
  createMissingStaff?: boolean;
  /** 自動登録候補（preview から渡される） */
  autoCreatableStaff?: Array<{
    empCode: string;
    name: string;
    employmentTypeCode: string | null;
  }>;
  /** 自動登録された empCode から本来の payload に上書きするためのバッファ
   *  preview の段階では未マッチ行が payload に含まれていないため、再 preview
   *  なしで取込まで完結させたい場合は executeShiftImportFromBuffer を使う。 */
  recomputePayload?: boolean;
}

/** 採用される payload を直接取込する。createMissingStaff=true の場合、
 *  与えられた autoCreatableStaff を staff テーブルに upsert してから shift を入れる。
 *
 *  payload は preview で生成された「マッチ済み」分のみ。新規登録した staff の
 *  シフトを含めるには executeShiftImportFromBuffer を利用してください。 */
export async function executeShiftImport(
  payload: ShiftPreview['payload'],
  options: ExecuteOptions = {},
): Promise<{ inserted: number; createdStaff: number }> {
  let createdStaff = 0;
  if (options.createMissingStaff && options.autoCreatableStaff?.length) {
    for (const c of options.autoCreatableStaff) {
      const code = deriveStaffCode(c.empCode);
      // 既存（empCode 一致）はスキップ。それ以外は新規 or 名前更新。
      const existing = await prisma.staff.findUnique({
        where: { empCode: c.empCode },
        select: { code: true },
      });
      if (existing) continue;
      try {
        await prisma.staff.create({
          data: {
            code,
            empCode: c.empCode,
            name: c.name,
            role: 'staff',
            employmentTypeCode: c.employmentTypeCode ?? null,
            assignable: true,
            active: true,
          },
        });
        createdStaff++;
      } catch (e) {
        // code 衝突などは無視して続行
        console.warn('[executeShiftImport] staff 作成スキップ', c.empCode, e);
      }
    }
  }

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
  return { inserted, createdStaff };
}

/** preview を内包したワンショット実行: CSV バッファを直接受け取り、
 *  必要なら staff を自動登録してから shift をインポートする。
 *  自動登録した社員の分も含めて取り込みできる。 */
export async function executeShiftImportFromBuffer(
  buffer: Buffer,
  options: { createMissingStaff: boolean },
): Promise<{
  inserted: number;
  createdStaff: number;
  unmatchedAfter: string[];
  unknownPatterns: string[];
}> {
  const preview = await previewShiftCsv(buffer);

  let createdStaff = 0;
  if (options.createMissingStaff && preview.autoCreatableStaff.length > 0) {
    for (const c of preview.autoCreatableStaff) {
      const code = deriveStaffCode(c.empCode);
      const existing = await prisma.staff.findUnique({
        where: { empCode: c.empCode },
        select: { code: true },
      });
      if (existing) continue;
      try {
        await prisma.staff.create({
          data: {
            code,
            empCode: c.empCode,
            name: c.name,
            role: 'staff',
            employmentTypeCode: c.employmentTypeCode ?? null,
            assignable: true,
            active: true,
          },
        });
        createdStaff++;
      } catch (e) {
        console.warn('[executeShiftImportFromBuffer] staff 作成スキップ', c.empCode, e);
      }
    }
  }

  // 再 preview して payload を再生成（自動登録分が staff に入っている）
  const preview2 = options.createMissingStaff ? await previewShiftCsv(buffer) : preview;

  let inserted = 0;
  for (const p of preview2.payload) {
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

  return {
    inserted,
    createdStaff,
    unmatchedAfter: preview2.unmatchedEmpCodes,
    unknownPatterns: preview2.unknownPatterns,
  };
}
