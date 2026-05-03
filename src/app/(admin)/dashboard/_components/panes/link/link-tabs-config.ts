/**
 * 基幹連携 サブタブ定義（A-11）
 *
 * モック準拠（管理用PCモック_v0.22.html L3078-3100）の 7 サブタブ。
 */

export type LinkSubTabId =
  | 'log'
  | 'unmap'
  | 'reimport'
  | 'aux-prod'
  | 'aux-cust'
  | 'aux-carr'
  | 'aux-set';

export interface LinkSubTabDef {
  id: LinkSubTabId;
  icon: string;
  main: string;
  sub: string;
  warn?: boolean;
}

export const LINK_SUBTABS: LinkSubTabDef[] = [
  { id: 'log', icon: '📜', main: '受信ログ', sub: '取込履歴 / エラー' },
  { id: 'unmap', icon: '⚠', main: '未マップ', sub: '基幹⇔WMS 差分', warn: true },
  { id: 'reimport', icon: '🔄', main: '手動再取込', sub: 'CSV / 個別取込' },
  { id: 'aux-prod', icon: '📦', main: '商品属性補助', sub: '冷凍/特殊/標準時間' },
  { id: 'aux-cust', icon: '👤', main: '顧客属性補助', sub: '企業/個人/置き配' },
  { id: 'aux-carr', icon: '🚚', main: '配送便マッピング', sub: '基幹文字→便種コード' },
  { id: 'aux-set', icon: '🎁', main: '構成品 / 同梱物', sub: 'セット展開・のし' },
];

export const DEFAULT_LINK_SUBTAB: LinkSubTabId = 'log';

export function isLinkSubTabId(v: string | null | undefined): v is LinkSubTabId {
  return !!v && LINK_SUBTABS.some((t) => t.id === v);
}
