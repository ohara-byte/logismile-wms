/**
 * 管理PC ダッシュボード右ペイン タブ定義
 *
 * モック準拠（管理用PCモック_v0.22.html L2452-2463）の 10 タブ。
 * バッジ件数は SSE / API で動的更新する想定（Sprint A-03/A-19 で接続）。
 *
 * 各タブの中身は Sprint A-04 以降で順次実装し、
 * 現状は placeholder pane を表示する。
 */

export type TabId =
  | 'alerts'
  | 'force'
  | 'ann'
  | 'carr'
  | 'search'
  | 'master'
  | 'link'
  | 'report'
  | 'match'
  | 'stockmatch'
  | 'mfg';

export interface TabDef {
  id: TabId;
  icon: string;
  label: string;
  /** バッジの色種別。'error' は赤・'warn' は橙・undefined は非表示 */
  badgeVariant?: 'error' | 'warn';
}

// Sprint G-2: 「割当」はテーブルグループ別進捗ヘッダーのモーダルへ集約したため右ペインから除去（モック L2452-2462 準拠）。
// Sprint Y-1: CSV タブは「ヘッダー CSV インポート」で代替できるため除去。
export const TABS: TabDef[] = [
  { id: 'alerts', icon: '🔔', label: 'アラート', badgeVariant: 'error' },
  { id: 'force', icon: '⚠', label: '強制OK', badgeVariant: 'error' },
  { id: 'ann', icon: '📢', label: '連絡', badgeVariant: 'error' },
  { id: 'carr', icon: '🚚', label: '運送' },
  { id: 'search', icon: '🔍', label: '検索' },
  { id: 'master', icon: '⚙', label: 'マスタ' },
  // Sprint Y-13: 「作業補助」タブは基幹連携の配下サブタブに統合（重複回避）。
  { id: 'link', icon: '🔌', label: '基幹連携', badgeVariant: 'warn' },
  { id: 'report', icon: '📊', label: 'レポート' },
  { id: 'match', icon: '📋', label: '出荷照合', badgeVariant: 'warn' },
  // Sprint Z-3: 在庫引当業務の運用タブ
  // Sprint Z-4: 用語整理 — 商品検品照合 → 「検品照合」, 旧 検品照合 → 「出荷照合」
  { id: 'stockmatch', icon: '📦', label: '検品照合', badgeVariant: 'warn' },
  { id: 'mfg', icon: '🏭', label: '製造指示', badgeVariant: 'error' },
  // Sprint Z-7: 「設定」はヘッダー（プリンタ試刷の隣）に移動。タブからは削除。
];

export const DEFAULT_TAB: TabId = 'alerts';

export function isTabId(v: string | null | undefined): v is TabId {
  return !!v && TABS.some((t) => t.id === v);
}
