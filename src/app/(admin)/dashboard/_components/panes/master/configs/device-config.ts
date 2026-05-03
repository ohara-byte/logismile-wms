import type { MasterConfig } from '../master-types';

interface Device extends Record<string, unknown> {
  code: string;
  name: string;
  type: string;
  model: string | null;
  location: string | null;
  active: boolean;
}

export const deviceConfig: MasterConfig<Device> = {
  name: 'device',
  title: '📱 端末マスタ',
  icon: '📱',
  endpoint: '/api/master/devices',
  primaryKey: 'code',
  searchPlaceholder: '🔍 コード／名称／設置場所で検索',
  hint: 'タブレット / ハンディ / プリンタ / PC を一元管理',
  filterField: 'type',
  filterPlaceholder: '─ 種別 ─',
  filterOptions: [
    { value: 'tablet', label: 'タブレット' },
    { value: 'handy', label: 'ハンディ' },
    { value: 'printer', label: 'プリンタ' },
    { value: 'pc', label: 'PC' },
  ],
  columns: [
    {
      key: 'active',
      label: '稼働',
      align: 'center',
      width: 56,
      render: (r) => (r.active ? '✓' : '✗'),
    },
    { key: 'code', label: 'コード', mono: true, width: 100 },
    { key: 'name', label: '名称' },
    {
      key: 'type',
      label: '種別',
      width: 80,
      render: (r) =>
        r.type === 'tablet' ? '📱 タブレット' :
        r.type === 'handy' ? '🔦 ハンディ' :
        r.type === 'printer' ? '🖨 プリンタ' :
        r.type === 'pc' ? '💻 PC' : r.type,
    },
    { key: 'model', label: '型番', truncate: true, width: 130 },
    { key: 'location', label: '設置場所', truncate: true, width: 140 },
  ],
  formFields: [
    { name: 'code', label: 'コード', type: 'text', required: true, readonlyOnEdit: true },
    { name: 'name', label: '名称', type: 'text', required: true },
    {
      name: 'type',
      label: '種別',
      type: 'select',
      required: true,
      options: [
        { value: 'tablet', label: 'タブレット' },
        { value: 'handy', label: 'ハンディ' },
        { value: 'printer', label: 'プリンタ' },
        { value: 'pc', label: 'PC' },
      ],
    },
    { name: 'model', label: '型番', type: 'text', placeholder: '例: HP14-na2095TU' },
    { name: 'location', label: '設置場所', type: 'text', placeholder: '例: 1F 検品棚' },
    { name: 'active', label: '稼働中', type: 'boolean' },
  ],
  initialValues: { type: 'tablet', active: true },
};
