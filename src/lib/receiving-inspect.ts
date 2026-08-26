/**
 * ハンディ 受入検品の入力ロジック（純関数・DB非依存）
 *
 * 2026-08-26 新規（現場要望「ハンディ検品システム 改修要望書」B案）:
 *   旧仕様は「記録／修正」の1ボタンで、既に検品済みの商品へ再登録すると
 *   **先の検品数を単純に上書き**していた。そのため
 *     ① 複数ハンディで同一商品を検品すると先の分が消える
 *     ② 不足分の追加運搬のたびに、画面の数を目視で足してから入力する必要がある
 *   という事故と手間が起きていた。
 *
 *   操作を2つに分離した。
 *     'add'（追加）… 常に加算。日常運用。
 *     'set'（訂正）… 既存値を上書き。誤入力を正すときだけ。
 *
 *   ここには「二重計上を生まないための判断」だけを置く。実際の保存は
 *   POST /api/handy/receiving-inspect（mode を渡す）。
 */

/** 記録方法。'add'=加算（追加）／'set'=上書き（訂正）。 */
export type InspectMode = 'add' | 'set';

/**
 * スキャン時に検品数欄へ入れる初期値を決める。
 *
 * ★ 既に検品済みの商品では **空** を返す。
 *   「追加」は加算なので、納品数を初期表示すると押した瞬間に二重計上になる。
 *   今回運ばれてきた分だけを人が入力する。
 *
 * @param current      いま入力欄にある値（編集中なら尊重する）
 * @param inspectedQty 検品済み数（合計）
 * @param deliveredQty 納品数
 */
export function resolveQtyPrefill(params: {
  current: string | null | undefined;
  inspectedQty: number;
  deliveredQty: number;
}): string {
  const { current, inspectedQty, deliveredQty } = params;
  // 編集中の入力は上書きしない
  if (current != null && current !== '') return current;
  // 検品済みがあるなら空（加算前提）
  if (inspectedQty > 0) return '';
  // 未検品は全数検品が通常なので納品数を初期表示
  return String(deliveredQty);
}

export type InspectInputResult =
  | { ok: true; qty: number }
  | { ok: false; message: string };

/**
 * 入力値を検証して数量を返す。
 *
 * - 空欄・非整数・負数は不可（どちらのモードでも）
 * - `add` で 0 は不可（何も足さない＝入力ミスの可能性が高い）
 * - `set` で 0 は **可**（検品数を 0 に戻す正当な訂正）
 */
export function validateInspectInput(params: {
  raw: string | null | undefined;
  mode: InspectMode;
}): InspectInputResult {
  const { raw, mode } = params;
  if (raw == null || raw.trim() === '') {
    return { ok: false, message: '数量を入力してください' };
  }
  const qty = Number(raw);
  if (!Number.isInteger(qty) || qty < 0) {
    return { ok: false, message: '数量を入力してください' };
  }
  if (mode === 'add' && qty === 0) {
    return { ok: false, message: '追加する数量は 1 以上です' };
  }
  return { ok: true, qty };
}
