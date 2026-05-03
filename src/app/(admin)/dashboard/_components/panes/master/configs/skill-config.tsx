/**
 * 担当者スキル設定（A-10b）
 *
 * staff マスタの skillCoefficient 列に特化したビュー。
 * 同じ /api/master/staff エンドポイントを使うが、表示列とフォームを
 * スキル管理に絞ったもの。
 */

import type { MasterConfig } from '../master-types';

interface StaffSkill extends Record<string, unknown> {
  code: string;
  name: string;
  groupId: string | null;
  employmentTypeCode: string | null;
  skillCoefficient: number;
  active: boolean;
  empCode: string;
  // 必須フィールド（PUT で必要なので保持）
  role: string;
  assignable: boolean;
}

export const skillConfig: MasterConfig<StaffSkill> = {
  name: 'skill',
  title: '📊 担当者スキル',
  icon: '📊',
  endpoint: '/api/master/staff',
  primaryKey: 'code',
  searchPlaceholder: '🔍 コード／氏名で検索',
  hint: 'スキル係数 1.000=標準 / 0.7=熟練（速い） / 1.5=新人（遅い）',
  filterField: 'active',
  filterPlaceholder: '─ 状態 ─',
  filterOptions: [
    { value: 'true', label: '在籍のみ' },
    { value: 'false', label: '退職のみ' },
  ],
  columns: [
    { key: 'code', label: 'コード', mono: true, width: 80 },
    { key: 'name', label: '氏名' },
    { key: 'groupId', label: 'グループ', width: 80 },
    { key: 'employmentTypeCode', label: '雇用区分', width: 100 },
    {
      key: 'skillCoefficient',
      label: 'スキル係数',
      align: 'right',
      mono: true,
      width: 100,
      render: (r) => {
        const v = Number(r.skillCoefficient);
        const cls =
          v < 0.85
            ? 'text-status-ok font-bold'
            : v > 1.15
              ? 'text-status-warn'
              : 'text-ink';
        const label = v < 0.85 ? '熟練' : v > 1.15 ? '新人' : '標準';
        return (
          <span className={cls}>
            {v.toFixed(3)}
            <span className="ml-1 text-3xs opacity-70">({label})</span>
          </span>
        );
      },
    },
    {
      key: 'active',
      label: '在籍',
      align: 'center',
      width: 56,
      render: (r) => (r.active ? '✓' : '✗'),
    },
  ],
  formFields: [
    { name: 'code', label: 'コード', type: 'text', readonlyOnEdit: true, required: true },
    { name: 'name', label: '氏名', type: 'text', required: true },
    { name: 'empCode', label: '社員番号', type: 'text', required: true },
    {
      name: 'role',
      label: 'ロール',
      type: 'select',
      required: true,
      options: [
        { value: 'admin', label: '管理者' },
        { value: 'manager', label: '責任者' },
        { value: 'staff', label: 'スタッフ' },
      ],
    },
    { name: 'groupId', label: 'グループ', type: 'text' },
    { name: 'employmentTypeCode', label: '雇用区分', type: 'text' },
    {
      name: 'skillCoefficient',
      label: 'スキル係数',
      type: 'number',
      step: 0.001,
      min: 0,
      max: 9.999,
      required: true,
      helpText: '0.7=熟練 / 1.0=標準 / 1.5=新人',
    },
    { name: 'assignable', label: '割当可', type: 'boolean' },
    { name: 'active', label: '在籍', type: 'boolean' },
  ],
  initialValues: { skillCoefficient: 1.0, role: 'staff', assignable: true, active: true },
};
