import type { MasterConfig } from '../master-types';

interface Group extends Record<string, unknown> {
  id: string;
  name: string;
  tables: string[];
  tablesText?: string;
  category: string;
  needStaff: number;
  note: string | null;
}

export const groupConfig: MasterConfig<Group> = {
  name: 'group',
  title: '🏷 検品グループ構成',
  icon: '🏷',
  endpoint: '/api/master/groups',
  primaryKey: 'id',
  searchPlaceholder: '🔍 ID／名称／カテゴリで検索',
  hint: 'tables はカンマ区切りで複数指定（例: ABL, FJK）',
  columns: [
    { key: 'id', label: 'ID', mono: true, width: 80 },
    { key: 'name', label: '名称' },
    { key: 'category', label: 'カテゴリ', width: 100 },
    {
      key: 'tablesText',
      label: 'テーブル',
      truncate: true,
      width: 200,
      render: (r) => (r.tablesText as string) ?? r.tables.join(', '),
    },
    { key: 'needStaff', label: '必要人数', align: 'right', mono: true, width: 80 },
  ],
  formFields: [
    { name: 'id', label: 'ID', type: 'text', required: true, readonlyOnEdit: true, helpText: '英数字 10 文字以内' },
    { name: 'name', label: '名称', type: 'text', required: true },
    { name: 'category', label: 'カテゴリ', type: 'text', required: true, placeholder: '例: 通常 / 冷凍 / 仕分' },
    {
      name: 'tables',
      label: 'テーブル',
      type: 'text',
      placeholder: 'カンマ区切り 例: A, B, C',
      helpText: 'グループに紐付くテーブル ID をカンマ区切りで列挙',
    },
    { name: 'needStaff', label: '必要人数', type: 'number', min: 0 },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: { needStaff: 1 },
};
