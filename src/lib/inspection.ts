/**
 * 検品ロジック共通ヘルパー
 *
 * scan 入力（JAN または 商品コード）から、出荷指示明細とのマッチング結果を判定する。
 *
 * 結果区分:
 *  - matched      : 一致 + 数量加算
 *  - over_scan    : 数量超過
 *  - not_found    : 該当する明細なし
 *  - already_done : 既に scannedQty == qty
 *
 * ★ JAN プール方式（2026-06-04）:
 *   JAN は複数商品で共有可（非ユニーク）。同一伝票に「商品コード違い・JAN一致」の
 *   明細が複数あると、バーコード上は区別できない（同じ JAN バーコード）。
 *   そこで JAN 一致のスキャンは、同一 JAN の明細を **合算プール** とみなし、
 *   「残数のある先頭の明細」に順に流し込む。これにより必要数ぶん JAN を
 *   スキャンするだけで、商品コードを意識せず全明細を完了できる。
 *   ※ 商品コードの完全一致スキャンは従来どおり「その単一明細」を対象とする。
 */

export type ScanResult = 'matched' | 'over_scan' | 'not_found' | 'already_done';

export interface OrderItem {
  id: number;
  productCode: string;
  product: { jan: string | null };
  qty: number;
  scannedQty: number;
}

/** 単一明細に対する加算判定（商品コード一致・JANプール内の対象明細で共用）。 */
function judgeForItem(
  item: OrderItem,
  qty: number,
): { result: ScanResult; itemId: number; nextScannedQty?: number } {
  if (item.scannedQty >= item.qty) {
    return { result: 'already_done', itemId: item.id };
  }
  const next = item.scannedQty + qty;
  if (next > item.qty) {
    // 残数超過は引き続きエラー扱い（ユーザー要望 2026-05-20）
    return { result: 'over_scan', itemId: item.id };
  }
  return { result: 'matched', itemId: item.id, nextScannedQty: next };
}

/** スキャン値（JAN または 商品コード）に該当する明細を見つけて結果区分を返す。 */
export function judgeScan(
  items: OrderItem[],
  scanValue: string,
  qty: number,
): { result: ScanResult; itemId?: number; nextScannedQty?: number } {
  const v = scanValue.trim();
  if (!v) return { result: 'not_found' };

  // ① 商品コードの完全一致を優先 → その単一明細を対象（数量手入力等で使用）
  const byCode = items.find((i) => i.productCode === v);
  if (byCode) return judgeForItem(byCode, qty);

  // ② JAN 一致 → 同一 JAN の明細を「プール」として、残数のある先頭明細に流し込む
  const pool = items.filter((i) => i.product.jan != null && i.product.jan === v);
  if (pool.length === 0) return { result: 'not_found' };

  const target = pool.find((i) => i.scannedQty < i.qty);
  if (!target) {
    // 同一 JAN の明細がすべて満杯（プール完了）
    return { result: 'already_done', itemId: pool[0].id };
  }
  return judgeForItem(target, qty);
}

/** 全アイテムが scannedQty == qty (or forceOk) なら true。 */
export function isAllInspected(
  items: { qty: number; scannedQty: number; forceOk: boolean }[],
): boolean {
  return items.every((i) => i.forceOk || i.scannedQty >= i.qty);
}
