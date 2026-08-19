/**
 * 出荷指示 明細の重複マージ
 *
 * 2026-08-19 新規（現場報告）:
 *   基幹（Thomas）CSV は、同じ商品を 1 伝票内に複数行で出すことがある。
 *   例）SG01235120666（冨岡様）
 *       10-36 ×1  ◆八頭ばうむ いち輪【製品数】
 *       10-36 ×1  ◆八頭ばうむ いち輪【製品数】
 *
 *   一方 DB は `@@unique([orderId, productCode])`（ShippingOrderItem）を持つため、
 *   これをそのまま nested create すると **ユニーク制約違反で伝票の作成ごと失敗** し、
 *   伝票が丸ごと取り込まれない（検索しても出てこない）状態になっていた。
 *   しかもエラーは「DB書込失敗（詳細はサーバログ）」としか出ず、理由が追えなかった。
 *
 * 方針（小原様確定 2026-08-19）:
 *   同一伝票内の同じ商品コードは **数量を合算して 1 明細** にする。
 *   同じ商品が行に分かれているだけなので、合算が業務的に正しい。
 *   検品画面でも同じ商品が 1 行にまとまり、現場の見え方が自然になる。
 */

export interface RawOrderItem {
  productCode: string;
  productName: string;
  qty: number;
  sortOrder: number;
  rowIndex: number;
}

export interface MergedItem extends RawOrderItem {
  /** 合算元の行数（1 なら重複なし）。取込ログに残して後から追えるようにする。 */
  mergedRows: number;
}

export interface MergeResult {
  items: MergedItem[];
  /** 実際に合算が起きた商品（監査・ログ用） */
  merged: { productCode: string; productName: string; rows: number; totalQty: number }[];
}

/**
 * 同一商品コードの明細を数量合算で 1 件にまとめる。
 *
 * - 並び順・品名は **最初に現れた行** を採用する（基幹の並びを尊重）
 * - sortOrder は詰め直す（0,1,2… の連番）
 * - 商品コードの比較は前後空白を除いた完全一致。大小の違いは商品マスタが
 *   区別しうるため正規化しない（勝手に別商品を同一視しない）
 */
export function mergeDuplicateItems(items: RawOrderItem[]): MergeResult {
  const byCode = new Map<string, MergedItem>();

  for (const it of items) {
    const key = it.productCode.trim();
    const found = byCode.get(key);
    if (found) {
      found.qty += it.qty;
      found.mergedRows += 1;
    } else {
      byCode.set(key, { ...it, productCode: key, mergedRows: 1 });
    }
  }

  const items2 = Array.from(byCode.values()).map((it, i) => ({ ...it, sortOrder: i }));
  const merged = items2
    .filter((it) => it.mergedRows > 1)
    .map((it) => ({
      productCode: it.productCode,
      productName: it.productName,
      rows: it.mergedRows,
      totalQty: it.qty,
    }));

  return { items: items2, merged };
}
