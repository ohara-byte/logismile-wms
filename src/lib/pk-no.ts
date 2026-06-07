/**
 * ピッキング№ ユーティリティ
 *
 * 仕様（業務ルール）:
 *   - ピッキング№は `S` + テーブル記号(A〜Z) + 数字 で構成される
 *   - 先頭の `S` は固定プレフィックス。読み飛ばし、次のアルファベットがテーブル記号
 *
 * 例:
 *   - `SV01211730063` → テーブル記号 `V`
 *   - `SA01208680006` → テーブル記号 `A`
 *   - `SB02000000001` → テーブル記号 `B`
 *
 * 想定外フォーマットは null を返す。
 */
export function parseTableLetter(pkNo: string | null | undefined): string | null {
  if (!pkNo) return null;
  const m = pkNo.match(/^S([A-Z])\d/);
  return m ? m[1] : null;
}

/**
 * 表示用のプレフィックス（テーブル記号）。
 * 旧 `pkNoPrefix` の置き換え。表示は「テーブル記号 1 文字」のみ返す。
 */
export function pkNoPrefix(pkNo: string | null | undefined): string | null {
  return parseTableLetter(pkNo);
}
