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
 */

export type ScanResult = 'matched' | 'over_scan' | 'not_found' | 'already_done';

export interface OrderItem {
  id: number;
  productCode: string;
  product: { jan: string | null };
  qty: number;
  scannedQty: number;
}

/** スキャン値（JAN または 商品コード）に該当する明細を見つけて結果区分を返す。 */
export function judgeScan(
  items: OrderItem[],
  scanValue: string,
  qty: number,
): { result: ScanResult; itemId?: number; nextScannedQty?: number } {
  const v = scanValue.trim();
  if (!v) return { result: 'not_found' };

  // 商品コード優先 → JAN
  const matchedItem =
    items.find((i) => i.productCode === v) ?? items.find((i) => i.product.jan === v);

  if (!matchedItem) return { result: 'not_found' };

  if (matchedItem.scannedQty >= matchedItem.qty) {
    return { result: 'already_done', itemId: matchedItem.id };
  }

  const next = matchedItem.scannedQty + qty;
  if (next > matchedItem.qty) {
    return { result: 'over_scan', itemId: matchedItem.id };
  }

  return { result: 'matched', itemId: matchedItem.id, nextScannedQty: next };
}

/** 全アイテムが scannedQty == qty (or forceOk) なら true。 */
export function isAllInspected(
  items: { qty: number; scannedQty: number; forceOk: boolean }[],
): boolean {
  return items.every((i) => i.forceOk || i.scannedQty >= i.qty);
}
