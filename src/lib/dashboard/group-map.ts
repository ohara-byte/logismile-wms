/**
 * 伝票（ピッキング№）→ テーブルグループの対応。
 *
 * ピッキング№の **2文字目**がテーブル文字で、それがどのグループに属するかは
 * 検品グループマスタ（`InspectionGroup.tables`）が持つ。
 * 例（要望書 2026-09-27 の対応表）：
 *   ABCSML … A, B, S, C, M, L ／ I … I ／ O … O ／ RQ … R, Q ／ DOKON-K … D, E, T, …
 *
 * ★ この規則は進捗ダッシュボード（progress.ts）と現場端末の進捗表示
 *   （field-progress.ts）の**両方**が使う。片方だけ直すと画面ごとに
 *   グループが食い違うため、ここに1つだけ置いて共有する。
 */

/** どのグループにも属さないテーブル文字の受け皿。 */
export const UNCLASSIFIED = '__UNCLASSIFIED__';

/** ピッキング№の2文字目（テーブル文字）。取れなければ ''。 */
export function tableLetterOf(pkNo: string): string {
  return pkNo.length >= 2 ? pkNo[1]!.toUpperCase() : '';
}

/**
 * テーブル文字 → グループID の索引。
 *
 * ★ 同じ文字が複数のグループに登録されていたら**先勝ち**。
 *   groups は sortOrder→id の昇順で渡すこと（単品群 'K' が 'SAS' より先に確定する）。
 */
export function buildLetterToGroup(
  groups: Array<{ id: string; tables: string[] }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of groups) {
    for (const t of g.tables) {
      const letter = (t ?? '').trim().toUpperCase();
      if (letter && !map.has(letter)) map.set(letter, g.id);
    }
  }
  return map;
}

/** 伝票のグループID。該当が無ければ UNCLASSIFIED。 */
export function groupOfPkNo(letterToGroup: Map<string, string>, pkNo: string): string {
  return letterToGroup.get(tableLetterOf(pkNo)) ?? UNCLASSIFIED;
}
