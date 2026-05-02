/**
 * JAN コード検証ロジック
 *
 * 仕様（CLAUDE.md / 設計メモ v2.1 表 7-1 より）：
 * - 13 桁（または 8 桁）の数字
 * - チェックデジット検証
 * - **★ 重複は許容**（products テーブルでは UNIQUE ではなく INDEX）
 *   構成商品コードが異なれば同一 JAN を共有可
 *
 * 取込時に検出するエラー:
 *  - 空欄（必要に応じて呼び出し側で許容を判断）
 *  - 桁数不正
 *  - チェックデジット不正
 *  - 数字以外の混入
 */

export type JanValidationCode =
  | 'ok'
  | 'empty'
  | 'invalid_length'
  | 'non_digit'
  | 'invalid_check_digit';

export interface JanValidationResult {
  code: JanValidationCode;
  isValid: boolean;
  message?: string;
  normalized?: string;
}

const ALLOWED_LENGTHS = [8, 13] as const;

/**
 * JAN チェックデジット計算（GTIN-8 / GTIN-13 共通アルゴリズム）。
 * 末尾を除く桁を右から偶数位＝×3, 奇数位＝×1 で合計し、10 の倍数になるように補う値を返す。
 */
export function calcCheckDigit(digits12or7: string): number {
  let sum = 0;
  // 右端（チェックデジット位置を除く）から番号付け：右端=1, 左へ 2, 3, ...
  for (let i = 0; i < digits12or7.length; i++) {
    const n = Number(digits12or7[digits12or7.length - 1 - i]);
    const weight = i % 2 === 0 ? 3 : 1;
    sum += n * weight;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

/**
 * JAN コードを検証する。
 * 重複は **チェックしない**（仕様により許容）。
 */
export function validateJan(raw: string | null | undefined): JanValidationResult {
  const value = (raw ?? '').trim();

  if (value === '') {
    return { code: 'empty', isValid: false, message: 'JAN が空欄です' };
  }

  if (!/^\d+$/.test(value)) {
    return {
      code: 'non_digit',
      isValid: false,
      message: `JAN に数字以外が含まれています: "${raw}"`,
    };
  }

  if (!ALLOWED_LENGTHS.includes(value.length as 8 | 13)) {
    return {
      code: 'invalid_length',
      isValid: false,
      message: `JAN の桁数が不正です（${value.length} 桁、許容: 8 or 13）`,
    };
  }

  const expected = calcCheckDigit(value.slice(0, -1));
  const actual = Number(value.slice(-1));
  if (expected !== actual) {
    return {
      code: 'invalid_check_digit',
      isValid: false,
      message: `JAN のチェックデジットが不正です（期待値=${expected}, 実値=${actual}）`,
      normalized: value,
    };
  }

  return { code: 'ok', isValid: true, normalized: value };
}
