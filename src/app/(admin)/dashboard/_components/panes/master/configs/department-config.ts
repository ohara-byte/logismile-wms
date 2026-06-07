/**
 * 🏢 部署マスタ（Sprint Y-7）
 *
 * 担当者マスタの「部署」セレクト元データ。
 * 例: 製造 / 出荷 / 配送 / 仕分 / 検品 / 管理 / 事務 / その他
 */

import type { MasterConfig } from '../master-types';

interface Department extends Record<string, unknown> {
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
  note: string | null;
}

export const departmentConfig: MasterConfig<Department> = {
  name: 'department',
  title: '🏢 部署マスタ',
  icon: '🏢',
  endpoint: '/api/master/departments',
  primaryKey: 'code',
  searchPlaceholder: '🔍 コード／名称で検索',
  hint: '担当者マスタの「部署」プルダウンに反映されます',
  filterField: 'active',
  filterPlaceholder: '─ 状態 ─',
  filterOptions: [
    { value: 'true', label: '有効のみ' },
    { value: 'false', label: '無効のみ' },
  ],
  columns: [
    {
      key: 'active',
      label: '状態',
      align: 'center',
      width: 56,
      render: (r) => (r.active ? '✓' : '✗'),
    },
    { key: 'code', label: 'コード', mono: true, width: 110 },
    { key: 'name', label: '名称' },
    { key: 'sortOrder', label: '表示順', align: 'right', mono: true, width: 80 },
    { key: 'note', label: '備考', truncate: true },
  ],
  formFields: [
    {
      name: 'code',
      label: 'コード',
      type: 'text',
      required: true,
      readonlyOnEdit: true,
      helpText: '一意（例: MFG, SHIP, DELI 等）',
    },
    { name: 'name', label: '名称', type: 'text', required: true, placeholder: '例: 製造' },
    {
      name: 'sortOrder',
      label: '表示順',
      type: 'number',
      min: 0,
      helpText: '小さいほど上位。0=未設定（コード順）',
    },
    {
      name: 'active',
      label: '有効',
      type: 'boolean',
      helpText: 'OFF にすると新規担当者の選択肢から除外（既存登録は影響なし）',
    },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: { sortOrder: 10, active: true },
};
