/**
 * 権限マトリクス（クライアント/サーバ共用 — Sprint Y-11）
 *
 * このファイルは next/headers などサーバ専用 API に依存しない純粋な型・関数のみ。
 * permissions.ts は本ファイルを内部で使い、追加でサーバ用ガードを提供する。
 */

export type Role = 'admin' | 'manager' | 'lead' | 'staff' | 'parttime';

export const ROLE_LABELS: Record<Role, string> = {
  admin: '管理者',
  manager: '責任者',
  lead: 'リーダー',
  staff: 'スタッフ',
  parttime: 'アルバイト',
};

// ─────────────────────────────────────────────────────────────
// 機能別権限マトリクス
// ─────────────────────────────────────────────────────────────
export const PERMISSIONS = {
  // マスタ編集（担当者・端末・商品・運送・グループ・標準時間・シフト・箱・プリンタ等）
  master_edit: ['admin', 'manager'],
  // マスタ閲覧（編集できなくても見られる）
  master_view: ['admin', 'manager', 'lead'],

  // CSV 取込（基幹データ取込）
  csv_import: ['admin', 'manager'],
  // CSV 出力（一覧 / レポート / マスタからのダウンロード）
  csv_export: ['admin', 'manager', 'lead'],

  // ダッシュボード / レポート閲覧
  dashboard_view: ['admin', 'manager', 'lead'],
  reports_view: ['admin', 'manager', 'lead'],

  // 強制OK の承認・却下
  force_approve: ['admin', 'manager'],
  // 強制OK の起票（モバイル端末で発生）— アルバイトは起票不可
  force_create: ['admin', 'manager', 'lead', 'staff'],

  // 伝票の削除・復活
  order_delete: ['admin', 'manager'],
  order_restore: ['admin', 'manager'],

  // メンバー割当
  assignment_edit: ['admin', 'manager', 'lead'],
  assignment_view: ['admin', 'manager', 'lead'],

  // 検品作業（タブレット・ハンディ）— 全ロール可
  inspect: ['admin', 'manager', 'lead', 'staff', 'parttime'],

  // ユーザー管理（admin 専有）
  user_admin: ['admin'],

  // PII 閲覧（電話番号・入社日 等）
  pii_view: ['admin', 'manager'],

  // 連絡事項の発信（管理 PC → 端末）
  notice_send: ['admin', 'manager', 'lead'],

  // QR ラベル印刷（再印刷・試刷）
  print_test: ['admin', 'manager'],
  print_reprint: ['admin', 'manager', 'lead'],
} as const satisfies Record<string, readonly Role[]>;

export type PermissionKey = keyof typeof PERMISSIONS;

/** ロールが特定の機能権限を持つか */
export function hasPermission(
  role: Role | null | undefined,
  perm: PermissionKey,
): boolean {
  if (!role) return false;
  return (PERMISSIONS[perm] as readonly Role[]).includes(role);
}
