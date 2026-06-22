/**
 * マスタ取込用の CSV 読み取り（2026-06-22）。
 * - 文字コード自動判定：UTF-8 BOM → UTF-8、それ以外は Shift-JIS（iconv-lite）。
 *   ※基幹(Thomas)CSV は NEC/IBM 拡張バイトを含むため GNU iconv 不可・iconv-lite 必須。
 * - RFC4180 準拠の簡易パーサ（引用符・引用符内改行に対応）。
 */

import iconv from 'iconv-lite';

export function decodeBuffer(buf: Buffer): string {
  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString('utf8').replace(/^﻿/, '');
  }
  // 簡易判定：UTF-8 として decode し、置換文字が多ければ Shift-JIS とみなす
  const asUtf8 = buf.toString('utf8');
  const replacements = (asUtf8.match(/�/g) ?? []).length;
  if (replacements > buf.length * 0.001) {
    return iconv.decode(buf, 'Shift_JIS');
  }
  return asUtf8;
}

/** RFC4180 準拠の簡易 CSV パーサ。行×列の文字列配列を返す。 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // CRLF の CR は無視
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** ファイルを decode → CSV 行配列にする */
export function readCsvRows(buf: Buffer): string[][] {
  return parseCsvRows(decodeBuffer(buf));
}
