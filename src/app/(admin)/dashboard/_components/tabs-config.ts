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
  | 'csv'
  | 'master'
  | 'link'
  | 'report'
  | 'match';

export interface TabDef {
  id: TabId;
  icon: string;
  label: string;
  /** バッジの色種別。'error' は赤・'warn' は橙・undefined は非表示 */
  badgeVariant?: 'error' | 'warn';
}

export const TABS: TabDef[] = [
  { id: 'alerts', icon: '🔔', label: 'アラート', badgeVariant: 'error' },
  { id: 'force', icon: '⚠', label: '強制OK', badgeVariant: 'error' },
  { id: 'ann', icon: '📢', label: '連絡', badgeVariant: 'error' },
  { id: 'carr', icon: '🚚', label: '運送' },
  { id: 'search', icon: '🔍', label: '検索' },
  { id: 'csv', icon: '📁', label: 'CSV' },
  { id: 'master', icon: '⚙', label: 'マスタ' },
  { id: 'link', icon: '🔌', label: '基幹連携', badgeVariant: 'warn' },
  { id: 'report', icon: '📊', label: 'レポート' },
  { id: 'match', icon: '📋', label: '未検品照合', badgeVariant: 'warn' },
];

export const DEFAULT_TAB: TabId = 'alerts';

export function isTabId(v: string | null | undefined): v is TabId {
  return !!v && TABS.some((t) => t.id === v);
}
