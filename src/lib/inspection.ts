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

export type ScanResult =
  | 'matched'
  | 'over_scan'
  | 'not_found'
  | 'already_done'
  // ラッピング代替バーコード関連（2026-06-23）
  | 'wrap_none' // 代替バーコードは現在伝票に一致したが、ラッピング明細が無い
  | 'wrong_order'; // 数字バーコードが別伝票のコアに一致（取り違え）

export interface OrderItem {
  id: number;
  productCode: string;
  product: { jan: string | null };
  /** 商品名（ラッピング判定に使用。2026-06-23） */
  productName?: string;
  qty: number;
  scannedQty: number;
}

/** ピッキング№から先頭の作業テーブル英字（SA/SO等）を除いた「コア」を返す。 */
export function stripPkPrefix(pkNo: string): string {
  return pkNo.replace(/^[A-Za-z]+/, '');
}

/** 既定のラッピング商品 判定プレフィックス（商品名の先頭）。 */
export const DEFAULT_WRAPPING_PREFIX = 'ラッピング';

/** 商品名の先頭が prefix か（NFKC正規化＋大小無視で前方一致）。 */
function isWrappingName(name: string | undefined, prefix: string): boolean {
  if (!name) return false;
  const norm = (s: string) => s.normalize('NFKC').trim().toUpperCase();
  return norm(name).startsWith(norm(prefix));
}

/** JAN 昇順（数値的）。null は最後。 */
function compareJanAsc(a: OrderItem, b: OrderItem): number {
  const ja = a.product.jan;
  const jb = b.product.jan;
  if (ja == null && jb == null) return 0;
  if (ja == null) return 1;
  if (jb == null) return -1;
  return ja.localeCompare(jb, undefined, { numeric: true });
}

export interface JudgeOptions {
  /** 現在開いている伝票のコア（pkNoから先頭英字を除いた値）。数字バーコード照合に使う。 */
  orderCore?: string;
  /** ラッピング商品 判定プレフィックス（商品名の先頭）。 */
  wrappingPrefix?: string;
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

/** スキャン値（JAN／商品コード／ラッピング代替バーコード）に該当する明細を判定する。 */
export function judgeScan(
  items: OrderItem[],
  scanValue: string,
  qty: number,
  opts: JudgeOptions = {},
): { result: ScanResult; itemId?: number; nextScannedQty?: number } {
  const v = scanValue.trim();
  if (!v) return { result: 'not_found' };

  // ⓪ ラッピング代替バーコード（2026-06-23）：
  //   ピッキング№は先頭に作業テーブル英字（SA/SO等）が付く。ラッピング商品に貼った
  //   代替バーコードはその英字を除いた「数字コア」。数字始まり かつ 現在伝票のコアと一致なら、
  //   未完了のラッピング明細（商品名が prefix で始まる）へ JAN 昇順で 1 個割当てる。
  //   ※同梱のため厳密な商品特定はしない（ユーザー方針）。英字始まり=ピッキング№は対象外。
  if (opts.orderCore && /^[0-9]/.test(v) && v === opts.orderCore) {
    const prefix = opts.wrappingPrefix ?? DEFAULT_WRAPPING_PREFIX;
    const wraps = items.filter((i) => isWrappingName(i.productName, prefix));
    if (wraps.length === 0) return { result: 'wrap_none' };
    const remaining = wraps.filter((i) => i.scannedQty < i.qty).sort(compareJanAsc);
    if (remaining.length === 0) {
      // ラッピング明細はあるが全完了
      return { result: 'already_done', itemId: wraps[0].id };
    }
    return judgeForItem(remaining[0], qty);
  }

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
