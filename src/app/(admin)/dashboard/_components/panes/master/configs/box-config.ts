import type { MasterConfig } from '../master-types';

interface Box extends Record<string, unknown> {
  code: string;
  name: string;
  type: string;
  sizeRank: number;
  wMm: number;
  dMm: number;
  hMm: number;
  frozen: boolean;
  noshi: boolean;
  priority: number;
  note: string | null;
}

export const boxConfig: MasterConfig<Box> = {
  name: 'box',
  title: '📦 箱マスタ',
  icon: '📦',
  endpoint: '/api/master/boxes',
  primaryKey: 'code',
  searchPlaceholder: '🔍 コード／名称で検索',
  hint: '固定箱・可変箱・追加箱の 3 種別。タブレット推奨箱表示で参照',
  filterField: 'type',
  filterPlaceholder: '─ 種別 ─',
  filterOptions: [
    { value: 'fixed', label: '固定箱' },
    { value: 'variable', label: '可変箱' },
    { value: 'additional', label: '追加箱' },
  ],
  columns: [
    { key: 'code', label: 'コード', mono: true, width: 110 },
    { key: 'name', label: '名称' },
    {
      key: 'type',
      label: '種別',
      align: 'center',
      width: 80,
      render: (r) =>
        r.type === 'fixed'
          ? '固定'
          : r.type === 'variable'
            ? '可変'
            : r.type === 'additional'
              ? '追加'
              : r.type,
    },
    { key: 'sizeRank', label: 'ランク', align: 'right', width: 70, mono: true },
    {
      key: 'size',
      label: '外寸 (mm)',
      width: 130,
      mono: true,
      render: (r) => `${r.wMm}×${r.dMm}×${r.hMm}`,
    },
    {
      key: 'frozen',
      label: '冷凍',
      align: 'center',
      width: 56,
      render: (r) => (r.frozen ? '❄' : ''),
    },
    {
      key: 'noshi',
      label: 'のし',
      align: 'center',
      width: 56,
      render: (r) => (r.noshi ? '🎁' : ''),
    },
    { key: 'priority', label: '優先度', align: 'right', width: 70 },
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
        { value: 'fixed', label: '固定箱' },
        { value: 'variable', label: '可変箱' },
        { value: 'additional', label: '追加箱' },
      ],
    },
    { name: 'sizeRank', label: 'サイズランク', type: 'number', min: 0, helpText: '小さいほど優先選択' },
    { name: 'wMm', label: '外寸 W (mm)', type: 'number', min: 0 },
    { name: 'dMm', label: '外寸 D (mm)', type: 'number', min: 0 },
    { name: 'hMm', label: '外寸 H (mm)', type: 'number', min: 0 },
    { name: 'innerWMm', label: '内寸 W (mm)', type: 'number', min: 0 },
    { name: 'innerDMm', label: '内寸 D (mm)', type: 'number', min: 0 },
    { name: 'innerHMm', label: '内寸 H (mm)', type: 'number', min: 0 },
    { name: 'frozen', label: '冷凍対応', type: 'boolean' },
    { name: 'noshi', label: 'のし対応', type: 'boolean' },
    { name: 'priority', label: '優先度', type: 'number', min: 1, max: 999 },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: { type: 'fixed', sizeRank: 0, priority: 50, frozen: false, noshi: false },
};
