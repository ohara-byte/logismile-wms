/**
 * マスタ管理 サブタブ定義（A-09）
 *
 * モック準拠（管理用PCモック_v0.22.html L3007-3016）の 10 サブタブ。
 */

export type MasterSubTabId =
  | 'staff'
  | 'department'
  | 'device'
  | 'product'
  | 'stock'
  | 'carrier'
  | 'carrierAlias'
  | 'noshiExclusion'
  | 'qrForceKeyword'
  | 'group'
  | 'stdtime'
  | 'skill'
  | 'shift'
  | 'pattern'
  | 'box'
  | 'printer'
  | 'user';

export interface MasterSubTabDef {
  id: MasterSubTabId;
  icon: string;
  label: string;
  /** Sprint Y-12: タブを admin ロールのみに表示する場合 true */
  adminOnly?: boolean;
}

export const MASTER_SUBTABS: MasterSubTabDef[] = [
  { id: 'staff', icon: '👤', label: '担当者' },
  // Sprint Y-7: 部署マスタ（担当者マスタの選択肢）
  { id: 'department', icon: '🏢', label: '部署' },
  { id: 'device', icon: '📱', label: '端末' },
  { id: 'product', icon: '📦', label: '構成商品' },
  // Sprint Z-1: 在庫マスタ（SKU 単位）
  { id: 'stock', icon: '📊', label: '在庫' },
  { id: 'carrier', icon: '🚚', label: '運送会社' },
  // 2026-06-02: 基幹CSVの便種名 → 運送会社コード のマッピング編集
  { id: 'carrierAlias', icon: '🔀', label: '配送便種マッピング' },
  // 2026-06-02: のし確認 除外 / QR印刷 強制 マスタ
  { id: 'noshiExclusion', icon: '🚫', label: 'のし除外' },
  { id: 'qrForceKeyword', icon: '🖨', label: 'QR印刷強制' },
  { id: 'group', icon: '🏷', label: 'グループ構成' },
  { id: 'stdtime', icon: '⏱', label: '標準時間' },
  { id: 'skill', icon: '📊', label: '担当者スキル' },
  { id: 'shift', icon: '📅', label: 'シフト' },
  { id: 'pattern', icon: '🕐', label: 'シフトパターン' },
  { id: 'box', icon: '📦', label: '箱' },
  // Sprint Y-6: プリンタマスタ（IP / ポート / 機種 / 配置 etc.）
  { id: 'printer', icon: '🖨', label: 'プリンタ' },
  // Sprint Y-12: PC ログインユーザー管理（admin 専有）
  { id: 'user', icon: '👥', label: 'ユーザー', adminOnly: true },
];

export const DEFAULT_MASTER_SUBTAB: MasterSubTabId = 'staff';

export function isMasterSubTabId(v: string | null | undefined): v is MasterSubTabId {
  return !!v && MASTER_SUBTABS.some((t) => t.id === v);
}
