import type { MasterConfig } from '../master-types';

interface Shift extends Record<string, unknown> {
  id: number;
  date: string;
  staffCode: string;
  staffName: string | null;
  patternCode: string;
  startTime: string | null;
  endTime: string | null;
  source: string;
  note: string | null;
}

export const shiftConfig: MasterConfig<Shift> = {
  name: 'shift',
  title: '📅 シフト',
  icon: '📅',
  endpoint: '/api/master/shifts',
  primaryKey: 'id',
  searchPlaceholder: '🔍 担当者コード／氏名／日付で検索',
  hint: '直近 7 日分を表示。一括編集はシフト画面（/shift）の月次マトリクスで',
  filterField: 'source',
  filterPlaceholder: '─ ソース ─',
  filterOptions: [
    { value: 'manual', label: '手動' },
    { value: 'gp_csv', label: 'GP CSV 取込' },
    { value: 'auto', label: '自動' },
  ],
  columns: [
    { key: 'date', label: '日付', mono: true, width: 110 },
    { key: 'staffCode', label: '担当', mono: true, width: 80 },
    { key: 'staffName', label: '氏名' },
    { key: 'patternCode', label: 'パターン', mono: true, width: 90 },
    { key: 'startTime', label: '開始', mono: true, width: 70 },
    { key: 'endTime', label: '終了', mono: true, width: 70 },
    {
      key: 'source',
      label: 'ソース',
      width: 100,
      render: (r) =>
        r.source === 'manual' ? '手動' :
        r.source === 'gp_csv' ? 'GP取込' :
        r.source === 'auto' ? '自動' : r.source,
    },
  ],
  formFields: [
    { name: 'date', label: '日付', type: 'date', required: true, readonlyOnEdit: true },
    { name: 'staffCode', label: '担当者コード', type: 'text', required: true, readonlyOnEdit: true },
    { name: 'patternCode', label: 'シフトパターン', type: 'text', required: true, placeholder: '例: G7' },
    { name: 'startTime', label: '開始時刻', type: 'text', placeholder: 'HH:MM' },
    { name: 'endTime', label: '終了時刻', type: 'text', placeholder: 'HH:MM' },
    {
      name: 'source',
      label: 'ソース',
      type: 'select',
      options: [
        { value: 'manual', label: '手動' },
        { value: 'gp_csv', label: 'GP CSV 取込' },
        { value: 'auto', label: '自動' },
      ],
    },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: { source: 'manual' },
};
