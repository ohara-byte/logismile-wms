/**
 * レポート サブタブ定義（A-Rep1）
 *
 * モック準拠（管理用PCモック_v0.22.html L3546-3556）の 11 サブタブ。
 */

export type ReportSubTabId =
  | 'summary'
  | 'group'
  | 'table'
  | 'insptime'
  | 'staff'
  | 'force'
  | 'carrier'
  | 'product'
  | 'hourly'
  | 'error'
  | 'aux';

export interface ReportSubTabDef {
  id: ReportSubTabId;
  icon: string;
  label: string;
}

export const REPORT_SUBTABS: ReportSubTabDef[] = [
  { id: 'summary', icon: '📊', label: 'サマリー（日別）' },
  { id: 'group', icon: '🗂', label: 'テーブルグループ別' },
  { id: 'table', icon: '🏷', label: 'テーブル別' },
  { id: 'insptime', icon: '⏱', label: '検品時間分析' },
  { id: 'staff', icon: '👥', label: '担当者別MH' },
  { id: 'force', icon: '⚠', label: '強制OK分析' },
  { id: 'carrier', icon: '🚚', label: '配送便種別' },
  { id: 'product', icon: '🥇', label: '商品ランキング' },
  { id: 'hourly', icon: '⏰', label: '時間帯ピーク' },
  { id: 'error', icon: '🔁', label: '検品エラー率' },
  { id: 'aux', icon: '🔌', label: '補助マスタ発生' },
];

export const DEFAULT_REPORT_SUBTAB: ReportSubTabId = 'summary';

export function isReportSubTabId(v: string | null | undefined): v is ReportSubTabId {
  return !!v && REPORT_SUBTABS.some((t) => t.id === v);
}
