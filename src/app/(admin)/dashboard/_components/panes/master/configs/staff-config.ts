import type { MasterConfig } from '../master-types';

interface Staff extends Record<string, unknown> {
  code: string;
  empCode: string;
  name: string;
  kana: string | null;
  role: string;
  employmentTypeCode: string | null;
  groupId: string | null;
  defaultShiftPattern: string | null;
  tel: string | null;
  joined: string | null;
  assignable: boolean;
  active: boolean;
  skillCoefficient: number;
  note: string | null;
}

export const staffConfig: MasterConfig<Staff> = {
  name: 'staff',
  title: '👤 担当者マスタ',
  icon: '👤',
  endpoint: '/api/master/staff',
  primaryKey: 'code',
  searchPlaceholder: '🔍 コード／氏名／カナ／社員番号で検索',
  hint: '退職者は active=false で論理削除（実削除は履歴があるため不可）',
  filterField: 'active',
  filterPlaceholder: '─ 状態 ─',
  filterOptions: [
    { value: 'true', label: '在籍のみ' },
    { value: 'false', label: '退職のみ' },
  ],
  columns: [
    {
      key: 'active',
      label: '状態',
      align: 'center',
      width: 56,
      render: (r) => (r.active ? '✓' : '✗'),
    },
    { key: 'code', label: 'コード', mono: true, width: 80 },
    { key: 'empCode', label: '社員番号', mono: true, width: 100 },
    { key: 'name', label: '氏名' },
    { key: 'kana', label: 'カナ', truncate: true, width: 140 },
    {
      key: 'role',
      label: 'ロール',
      width: 80,
      render: (r) =>
        r.role === 'admin' ? '管理者' : r.role === 'manager' ? '責任者' : 'スタッフ',
    },
    { key: 'groupId', label: 'グループ', width: 80 },
    { key: 'employmentTypeCode', label: '雇用区分', width: 80 },
    { key: 'defaultShiftPattern', label: '既定シフト', width: 90, mono: true },
    {
      key: 'skillCoefficient',
      label: 'スキル',
      align: 'right',
      width: 70,
      mono: true,
      render: (r) => Number(r.skillCoefficient).toFixed(2),
    },
  ],
  formFields: [
    { name: 'code', label: 'コード', type: 'text', required: true, readonlyOnEdit: true, helpText: '内部識別 (10 文字以内)' },
    { name: 'empCode', label: '社員番号', type: 'text', required: true, helpText: 'モバイルログインに使用 (重複不可)' },
    { name: 'name', label: '氏名', type: 'text', required: true },
    { name: 'kana', label: 'カナ', type: 'text' },
    {
      name: 'role',
      label: 'ロール',
      type: 'select',
      required: true,
      options: [
        { value: 'admin', label: '管理者 (admin)' },
        { value: 'manager', label: '責任者 (manager)' },
        { value: 'staff', label: 'スタッフ (staff)' },
      ],
    },
    {
      name: 'employmentTypeCode',
      label: '雇用区分',
      type: 'text',
      placeholder: '例: REG_8H',
      helpText: 'employment_types.code',
    },
    { name: 'groupId', label: 'グループ ID', type: 'text', placeholder: '例: ABL' },
    { name: 'defaultShiftPattern', label: '既定シフトパターン', type: 'text', placeholder: '例: G7' },
    { name: 'tel', label: '電話番号', type: 'text' },
    { name: 'joined', label: '入社日', type: 'date' },
    { name: 'assignable', label: '割当可', type: 'boolean', helpText: 'メンバー割当ガントの対象にする' },
    { name: 'active', label: '在籍', type: 'boolean', helpText: '退職者は OFF（モバイルログイン不可になる）' },
    {
      name: 'skillCoefficient',
      label: 'スキル係数',
      type: 'number',
      step: 0.001,
      min: 0,
      max: 9.999,
      helpText: '1.000=標準。Phase 6-9 で実績ログから自動更新',
    },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: {
    role: 'staff',
    assignable: true,
    active: true,
    skillCoefficient: 1.0,
  },
};
