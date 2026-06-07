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
  | 'aux-set'
  | 'aux-campaign';

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
  // Sprint Y-2: 名称変更（構成商品属性補助／親商品）
  { id: 'aux-prod', icon: '📦', main: '構成商品属性補助', sub: '冷凍/特殊/標準時間/外寸' },
  // Sprint Y-13: 顧客属性補助を placeholder から本実装に格上げ
  { id: 'aux-cust', icon: '👤', main: '顧客属性補助', sub: '企業/個人/置き配/要注意' },
  { id: 'aux-carr', icon: '🚚', main: '配送便マッピング', sub: '基幹文字→便種コード' },
  { id: 'aux-set', icon: '🎁', main: '親商品（構成＋同梱品）', sub: 'セット展開・のし・同梱' },
  // Sprint Y-13: 期間限定キャンペーン（placeholder。新基幹連携稼働後に正式実装予定）
  { id: 'aux-campaign', icon: '📅', main: '期間限定キャンペーン', sub: '期間ルール（実装予定）' },
];

export const DEFAULT_LINK_SUBTAB: LinkSubTabId = 'log';

export function isLinkSubTabId(v: string | null | undefined): v is LinkSubTabId {
  return !!v && LINK_SUBTABS.some((t) => t.id === v);
}
