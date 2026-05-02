/**
 * CSV パーサー — Shift-JIS / UTF-8 自動判定
 *
 * Thomas 出力は Shift-JIS が標準だが、UTF-8 のケースも許容。
 * BOM 検出 → UTF-8 と判定。それ以外は Shift-JIS としてデコード。
 */

import Papa from 'papaparse';
import iconv from 'iconv-lite';

/** Buffer の文字コードを推測する（ざっくり: BOM があれば UTF-8、なければ Shift-JIS）。 */
export function detectEncoding(buffer: Buffer): 'utf-8' | 'shift_jis' {
  // UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf-8';
  }

  // 試しに UTF-8 でデコードして、不正バイトが少なければ UTF-8 とみなす
  try {
    const text = buffer.toString('utf8');
    // U+FFFD（置換文字）の出現が少なければ UTF-8 と判断
    const replacementRatio = (text.match(/�/g)?.length ?? 0) / Math.max(text.length, 1);
    if (replacementRatio < 0.001) return 'utf-8';
  } catch {
    // ignore
  }

  return 'shift_jis';
}

export interface CsvParseResult<T = Record<string, string>> {
  encoding: 'utf-8' | 'shift_jis';
  rows: T[];
  /** ヘッダ行（1 行目） */
  headers: string[];
}

/** CSV を文字コード自動判定でパースする。 */
export function parseCsv<T = Record<string, string>>(buffer: Buffer): CsvParseResult<T> {
  const encoding = detectEncoding(buffer);
  const text =
    encoding === 'utf-8'
      ? buffer.toString('utf8').replace(/^﻿/, '')
      : iconv.decode(buffer, 'Shift_JIS');

  const parsed = Papa.parse<T>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const headers =
    parsed.meta.fields?.map((f) => f.trim()) ?? Object.keys(parsed.data[0] ?? {});

  return {
    encoding,
    rows: parsed.data,
    headers,
  };
}

/**
 * CSV ヘッダから取込ファイル種別を推定する。
 * - "ピッキングNo" を含む → orders
 * - "JANコード" + "賞味期限管理区分" → products
 * - その他 → sort（暫定）
 */
export function detectFileType(headers: string[]): 'products' | 'orders' | 'sort' {
  const set = new Set(headers);
  if (set.has('ピッキングNo')) return 'orders';
  if (set.has('JANコード') && set.has('賞味期限管理区分')) return 'products';
  return 'sort';
}
