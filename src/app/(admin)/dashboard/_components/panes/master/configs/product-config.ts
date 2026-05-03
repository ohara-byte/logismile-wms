import type { MasterConfig } from '../master-types';

interface Product extends Record<string, unknown> {
  code: string;
  jan: string | null;
  name: string;
  cat: string;
  pkg: string;
  price: number;
  leadDays: number;
  stdSec: number;
  frozen: boolean;
  special: boolean;
  noshi: boolean;
  active: boolean;
}

export const productConfig: MasterConfig<Product> = {
  name: 'product',
  title: '📦 構成商品マスタ',
  icon: '📦',
  endpoint: '/api/master/products',
  primaryKey: 'code',
  searchPlaceholder: '🔍 コード／JAN／名称／カテゴリで検索',
  hint: '構成商品（JAN 付き）。親商品は基幹に存在し WMS では構成品マスタ逆引きで補完',
  filterField: 'cat',
  filterPlaceholder: '─ カテゴリ ─',
  // カテゴリは動的だが、よく使うものを列挙
  filterOptions: [
    { value: '生肉', label: '生肉' },
    { value: '加工肉', label: '加工肉' },
    { value: '卵', label: '卵' },
    { value: 'スイーツ', label: 'スイーツ' },
    { value: 'セット', label: 'セット' },
  ],
  columns: [
    { key: 'code', label: 'コード', mono: true, width: 110 },
    { key: 'jan', label: 'JAN', mono: true, width: 130 },
    { key: 'name', label: '名称', truncate: true },
    { key: 'cat', label: 'カテゴリ', width: 80 },
    { key: 'pkg', label: '梱包', width: 60 },
    {
      key: 'price',
      label: '税込',
      align: 'right',
      mono: true,
      width: 80,
      render: (r) => `¥${Number(r.price).toLocaleString()}`,
    },
    {
      key: 'frozen',
      label: '冷凍',
      align: 'center',
      width: 56,
      render: (r) => (r.frozen ? '❄' : ''),
    },
    {
      key: 'special',
      label: '特殊',
      align: 'center',
      width: 56,
      render: (r) => (r.special ? '★' : ''),
    },
    {
      key: 'noshi',
      label: 'のし',
      align: 'center',
      width: 56,
      render: (r) => (r.noshi ? '🎁' : ''),
    },
    {
      key: 'active',
      label: '有効',
      align: 'center',
      width: 56,
      render: (r) => (r.active ? '✓' : '✗'),
    },
  ],
  formFields: [
    { name: 'code', label: 'コード', type: 'text', required: true, readonlyOnEdit: true },
    { name: 'jan', label: 'JAN', type: 'text', placeholder: '13 桁・空欄可・重複可' },
    { name: 'name', label: '名称', type: 'text', required: true },
    { name: 'cat', label: 'カテゴリ', type: 'text', required: true },
    { name: 'pkg', label: '梱包単位', type: 'text', placeholder: '例: 箱' },
    { name: 'price', label: '税込価格', type: 'number', min: 0 },
    { name: 'leadDays', label: 'リード日数', type: 'number', min: 0 },
    { name: 'stdSec', label: '標準時間（秒）', type: 'number', min: 0 },
    { name: 'frozen', label: '冷凍', type: 'boolean' },
    { name: 'special', label: '特殊梱包', type: 'boolean' },
    { name: 'noshi', label: 'のし対象', type: 'boolean' },
    { name: 'active', label: '取扱中', type: 'boolean' },
  ],
  initialValues: { pkg: '箱', active: true, frozen: false, special: false, noshi: false },
};
