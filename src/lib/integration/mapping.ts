/**
 * Thomas（基幹）→ WMS 項目マッピング
 *
 * 設計メモ v2.1 表 7-1 / 表 7-2 に準拠。
 * 「熨斗フラグ」→「QR印刷フラグ」の読み替えを含む。
 */

/** 表 7-1: Thomas商品マスタ → WMS構成商品マスタ */
export const PRODUCT_CSV_COLUMNS = {
  CODE: '商品コード',
  NAME: '商品名',
  JAN: 'JANコード',
  EXPIRE_TYPE: '賞味期限管理区分', // 取込スキップ
  REMAINING_DAYS: '出荷可能残日数', // 取込スキップ
} as const;

/** 表 7-2: Thomas出荷指示データ → WMSピッキングデータ */
export const ORDER_CSV_COLUMNS = {
  SHIP_DATE: '出荷予定日',
  PK_NO: 'ピッキングNo',
  CARRIER: '配送便種', // 文字列。マッピングマスタで便種コード化
  PRODUCT_CODE: '商品コード',
  QTY: '出荷予定数',
  PRODUCT_NAME: '品名',
  DEST_ZIP: '送付先郵便番号',
  DEST_ADDR: '送付先住所1',
  DEST_NAME: '送付先名',
  INVOICE_NO: '納品書No',
  /** ★ 基幹「熨斗フラグ」→ WMS「QR印刷フラグ」 */
  QR_PRINT_FLAG: '熨斗フラグ',
  NOSHI_CODE: '熨斗コード', // 取込スキップ
  CUSTOMER_CODE: '顧客コード',
  ORDER_NO: '注文番号',
  NOSHI_NAME: '熨斗名称',
  NOSHI_PERSON: '熨斗氏名',
  DELIVERY_DATE: '配達指定日',
} as const;

/**
 * 配送便種（文字列）→ carriers.code への対応表。
 * carriers マスタにない場合は import 時にエラーログ＋デフォルトキャリア（YMT-N）にフォールバック。
 */
export const CARRIER_NAME_TO_CODE: Record<string, string> = {
  ヤマト運輸: 'YMT-N',
  'ヤマト運輸（クール便）': 'YMT-C',
  ヤマト便: 'YMT-N',
  佐川急便: 'SGW-N',
  '佐川急便（クール便）': 'SGW-C',
  ゆうパック: 'JPP-N',
  日本郵便: 'JPP-N',
};

/**
 * QR 印刷フラグ（基幹「熨斗フラグ」）の値解釈。
 * 空欄 / "0" / "なし" / "false" → false
 * それ以外（"1" / "あり" / "TRUE" / 任意の非空値） → true
 */
export function parseQrPrintFlag(raw: string | null | undefined): boolean {
  const v = (raw ?? '').trim();
  if (v === '') return false;
  if (v === '0' || v.toLowerCase() === 'false' || v === 'なし') return false;
  return true;
}
