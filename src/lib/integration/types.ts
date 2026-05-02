/**
 * IF アダプタ層 — 共通型定義
 *
 * フェーズ1：CSV取込（CsvAdapter）
 * フェーズ2：基幹API連携（ApiAdapter、将来）
 *
 * 設計指針: WMS本体はアダプタ差し替えで変更不要。
 */

/**
 * 取込ファイル種別。
 * `products` = Thomas商品マスタ（表 7-1）
 * `orders`   = Thomas出荷指示データ（表 7-2）
 * `sort`     = 仕分け作業指示データ
 */
export type FileType = 'products' | 'orders' | 'sort';

/** 取込全体の集計結果（thomas_imports テーブルに対応）。 */
export interface ImportResult {
  importId: number;
  fileType: FileType;
  filename: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  janErrorCount: number;
  duplicatePkNoCount: number;
  unmapCount: number;
  unmappedCodes: string[];
  errors: ImportRowError[];
}

/** 行単位の取込エラー。 */
export interface ImportRowError {
  rowIndex: number; // 1-origin（ヘッダ行を除く）
  pkNo?: string;
  productCode?: string;
  reason:
    | 'jan_empty'
    | 'jan_invalid_length'
    | 'jan_non_digit'
    | 'jan_invalid_check_digit'
    | 'duplicate_pk_no'
    | 'product_not_found'
    | 'carrier_not_found'
    | 'parse_error'
    | 'validation_error';
  message: string;
}

/** 取込元の表現。CSV はファイル、API はエンドポイント設定。 */
export type ImportSource =
  | { kind: 'csv'; buffer: Buffer; filename: string }
  | { kind: 'api'; endpoint: string; token: string };

/** 取込実行のメタ情報（誰が・どの環境で）。 */
export interface ImportContext {
  importedBy?: string; // staff.code（admin/manager 等）
}

/**
 * 取込アダプタ共通インターフェース。
 *
 * `importProducts` = 商品マスタ取込（products テーブルを upsert）
 * `importShippingOrders` = 出荷指示取込（shipping_orders + shipping_order_items を作成）
 */
export interface IntegrationAdapter {
  importProducts(source: ImportSource, ctx: ImportContext): Promise<ImportResult>;
  importShippingOrders(source: ImportSource, ctx: ImportContext): Promise<ImportResult>;
}
