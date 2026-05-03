/**
 * マスタ管理 サブタブ定義（A-09）
 *
 * モック準拠（管理用PCモック_v0.22.html L3007-3016）の 10 サブタブ。
 */

export type MasterSubTabId =
  | 'staff'
  | 'device'
  | 'product'
  | 'carrier'
  | 'group'
  | 'stdtime'
  | 'skill'
  | 'shift'
  | 'pattern'
  | 'box';

export interface MasterSubTabDef {
  id: MasterSubTabId;
  icon: string;
  label: string;
}

export const MASTER_SUBTABS: MasterSubTabDef[] = [
  { id: 'staff', icon: '👤', label: '担当者' },
  { id: 'device', icon: '📱', label: '端末' },
  { id: 'product', icon: '📦', label: '構成商品' },
  { id: 'carrier', icon: '🚚', label: '運送会社' },
  { id: 'group', icon: '🏷', label: 'グループ構成' },
  { id: 'stdtime', icon: '⏱', label: '標準時間' },
  { id: 'skill', icon: '📊', label: '担当者スキル' },
  { id: 'shift', icon: '📅', label: 'シフト' },
  { id: 'pattern', icon: '🕐', label: 'シフトパターン' },
  { id: 'box', icon: '📦', label: '箱' },
];

export const DEFAULT_MASTER_SUBTAB: MasterSubTabId = 'staff';

export function isMasterSubTabId(v: string | null | undefined): v is MasterSubTabId {
  return !!v && MASTER_SUBTABS.some((t) => t.id === v);
}
