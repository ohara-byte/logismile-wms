import type { MasterConfig } from '../master-types';

interface ShiftPattern extends Record<string, unknown> {
  code: string;
  name: string;
  startTime: string | null;
  endTime: string | null;
  breakMin: number;
  isOff: boolean;
  sortOrder: number;
  active: boolean;
}

export const patternConfig: MasterConfig<ShiftPattern> = {
  name: 'pattern',
  title: '🕐 シフトパターン',
  icon: '🕐',
  endpoint: '/api/master/shift-patterns',
  primaryKey: 'code',
  searchPlaceholder: '🔍 コード／名称で検索',
  hint: 'G7 / A6 / 公休 / 有休 等のパターン。担当者の既定シフトに紐付く',
  filterField: 'isOff',
  filterPlaceholder: '─ 種別 ─',
  filterOptions: [
    { value: 'true', label: '休暇のみ' },
    { value: 'false', label: '勤務のみ' },
  ],
  columns: [
    { key: 'code', label: 'コード', mono: true, width: 80 },
    { key: 'name', label: '名称' },
    { key: 'startTime', label: '開始', mono: true, width: 70 },
    { key: 'endTime', label: '終了', mono: true, width: 70 },
    {
      key: 'breakMin',
      label: '休憩',
      align: 'right',
      mono: true,
      width: 70,
      render: (r) => (r.breakMin > 0 ? `${r.breakMin}分` : '—'),
    },
    {
      key: 'isOff',
      label: '休暇',
      align: 'center',
      width: 56,
      render: (r) => (r.isOff ? '✓' : ''),
    },
    { key: 'sortOrder', label: '並び', align: 'right', mono: true, width: 60 },
    {
      key: 'active',
      label: '有効',
      align: 'center',
      width: 56,
      render: (r) => (r.active ? '✓' : '✗'),
    },
  ],
  formFields: [
    { name: 'code', label: 'コード', type: 'text', required: true, readonlyOnEdit: true, helpText: '英数 10 文字以内（例: G7, A6, 有休）' },
    { name: 'name', label: '名称', type: 'text', required: true, placeholder: '例: 7時間勤務 G' },
    { name: 'startTime', label: '開始時刻', type: 'text', placeholder: 'HH:MM' },
    { name: 'endTime', label: '終了時刻', type: 'text', placeholder: 'HH:MM' },
    { name: 'breakMin', label: '休憩 (分)', type: 'number', min: 0 },
    { name: 'isOff', label: '休暇扱い', type: 'boolean', helpText: '公休 / 有休 / 希休 / 特休 等' },
    { name: 'sortOrder', label: '並び順', type: 'number' },
    { name: 'active', label: '有効', type: 'boolean' },
  ],
  initialValues: { breakMin: 0, isOff: false, sortOrder: 50, active: true },
};
