/**
 * JAN コード検証ロジック
 *
 * 仕様（CLAUDE.md / 設計メモ v2.1 表 7-1 より）：
 * - 13 桁（または 8 桁）の数字 → ok（チェックデジット検証あり）
 * - **12 桁**（UPC-A 互換） → warn（取込可、検品可、後日修正対象）
 * - チェックデジット検証
 * - **★ 重複は許容**（products テーブルでは UNIQUE ではなく INDEX）
 *   構成商品コードが異なれば同一 JAN を共有可
 *
 * 2026-05-30: 現場要望により 12 桁を「警告」として取込許可。
 *   12 桁はチェックデジット OK / NG 問わず格納し、検品スキャンも可能。
 *   ただしアラートで可視化し、後日 13 桁形式へ修正することを促す。
 *
 * 取込時の判定:
 *  - 空欄（severity=error、必要に応じて呼び出し側で許容を判断）
 *  - 桁数不正（8/12/13 以外、severity=error）
 *  - チェックデジット不正（8/13 のみ、severity=error）
 *  - 数字以外の混入（severity=error）
 *  - **12 桁（severity=warn）→ 取込許可・検品可・要修正アラート**
 */

export type JanValidationCode =
  | 'ok'
  | 'empty'
  | 'invalid_length'
  | 'non_digit'
  | 'invalid_check_digit'
  | 'warn_12_digit';

/**
 * 検証重大度。
 *   ok    : 完全に正常。商品登録のみ。
 *   warn  : 完全準拠ではないが取込可。商品は登録され、後日修正用に alerts に記録。
 *   error : 取込不可。商品は登録されるが JAN は null、alerts に error として記録。
 */
export type JanSeverity = 'ok' | 'warn' | 'error';

export interface JanValidationResult {
  code: JanValidationCode;
  severity: JanSeverity;
  /** 取込フローで JAN を「採用」するかどうか。warn でも true（保存）。 */
  isValid: boolean;
  message?: string;
  /** 採用される JAN 値（空文字や trim 済）。warn の場合も生値を返す。 */
  normalized?: string;
}

/** 厳密に妥当とみなす桁数（チェックデジット検証あり）。 */
const STRICT_LENGTHS = [8, 13] as const;
/** 警告扱いで取込許可する桁数。 */
const WARN_LENGTHS = [12] as const;

/**
 * JAN チェックデジット計算（GTIN-8 / GTIN-12 / GTIN-13 共通アルゴリズム）。
 * 末尾を除く桁を右から偶数位＝×3, 奇数位＝×1 で合計し、10 の倍数になるように補う値を返す。
 */
export function calcCheckDigit(digitsExceptCheck: string): number {
  let sum = 0;
  // 右端（チェックデジット位置を除く）から番号付け：右端=1, 左へ 2, 3, ...
  for (let i = 0; i < digitsExceptCheck.length; i++) {
    const n = Number(digitsExceptCheck[digitsExceptCheck.length - 1 - i]);
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
    return {
      code: 'empty',
      severity: 'error',
      isValid: false,
      message: 'JAN が空欄です',
    };
  }

  if (!/^\d+$/.test(value)) {
    return {
      code: 'non_digit',
      severity: 'error',
      isValid: false,
      message: `JAN に数字以外が含まれています: "${raw}"`,
    };
  }

  // 12 桁（UPC-A 互換）— 警告扱いで取込許可
  if (WARN_LENGTHS.includes(value.length as 12)) {
    const expected = calcCheckDigit(value.slice(0, -1));
    const actual = Number(value.slice(-1));
    const checkOk = expected === actual;
    return {
      code: 'warn_12_digit',
      severity: 'warn',
      isValid: true,
      message: checkOk
        ? `12 桁 JAN として取込み済（後日 13 桁形式へ修正してください）`
        : `12 桁 JAN として取込み済。CD 不正（期待=${expected}, 実値=${actual}）。後日修正してください`,
      normalized: value,
    };
  }

  if (!STRICT_LENGTHS.includes(value.length as 8 | 13)) {
    return {
      code: 'invalid_length',
      severity: 'error',
      isValid: false,
      message: `JAN の桁数が不正です（${value.length} 桁、許容: 8 / 12 / 13）`,
    };
  }

  const expected = calcCheckDigit(value.slice(0, -1));
  const actual = Number(value.slice(-1));
  if (expected !== actual) {
    return {
      code: 'invalid_check_digit',
      severity: 'error',
      isValid: false,
      message: `JAN のチェックデジットが不正です（期待値=${expected}, 実値=${actual}）`,
      normalized: value,
    };
  }

  return { code: 'ok', severity: 'ok', isValid: true, normalized: value };
}
