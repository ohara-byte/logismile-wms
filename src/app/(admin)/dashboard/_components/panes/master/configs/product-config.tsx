import type { MasterConfig } from '../master-types';
import type { ReactNode } from 'react';

/** 名称（太字 1 行目）+ JAN（下段ミュート）を 2 段表示するセル */
function renderProductNameCell(r: Record<string, unknown>): ReactNode {
  const name = String(r.name ?? '');
  const jan = r.jan ? String(r.jan) : '';
  return (
    <div className="leading-tight">
      <div className="font-bold text-ink-strong truncate">{name || '—'}</div>
      <div className="font-mono text-3xs text-ink-muted truncate">
        {jan ? `JAN: ${jan}` : '（JAN なし）'}
      </div>
    </div>
  );
}

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
  // Sprint Z-1: 在庫引当機能
  productType: string;
  safetyStock: number;
  reorderPoint: number | null;
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
    // Sprint Y-4: JAN と 名称を 2 段組のセルに集約。横幅を圧迫しないよう 1 列にまとめる
    {
      key: 'name',
      label: '名称 / JAN',
      truncate: true,
      width: 260,
      render: (r) => (
        // eslint-disable-next-line react/no-string-refs
        renderProductNameCell(r as Record<string, unknown>)
      ),
    },
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
    // Sprint Z-1: 在庫引当機能用
    {
      key: 'productType',
      label: '種別',
      width: 80,
      render: (r) => {
        const t = String(r.productType ?? 'warehouse');
        return t === 'pass_through'
          ? '通過型'
          : t === 'made_to_order'
            ? '受注生産'
            : '倉庫在庫';
      },
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
    {
      name: 'productType',
      label: '商品種別',
      type: 'select',
      required: true,
      options: [
        { value: 'warehouse', label: '倉庫在庫（一般倉庫商品）' },
        { value: 'pass_through', label: '通過型（卵など当日生産）' },
        { value: 'made_to_order', label: '受注生産（前日18時〜当日17時生産）' },
      ],
      helpText: '在庫引当の挙動を決定。倉庫在庫=事前在庫から引当 / 通過型=出来高反映 / 受注生産=cutoff後の生産で引当',
    },
    {
      name: 'safetyStock',
      label: '安全在庫',
      type: 'number',
      min: 0,
      helpText: '0 で無効。閾値監視で利用',
    },
    {
      name: 'reorderPoint',
      label: '補充点',
      type: 'number',
      min: 0,
      helpText: '利用可能在庫がこれ以下で補充推奨アラート',
    },
    { name: 'frozen', label: '冷凍', type: 'boolean' },
    { name: 'special', label: '特殊梱包', type: 'boolean' },
    { name: 'noshi', label: 'のし対象', type: 'boolean' },
    { name: 'active', label: '取扱中', type: 'boolean' },
  ],
  initialValues: {
    pkg: '箱',
    active: true,
    frozen: false,
    special: false,
    noshi: false,
    // Sprint Y-13: 大江ノ郷自然牧場は基本「通過型」運用（卵・自社製造品）のため既定をこちらに変更
    productType: 'pass_through',
    safetyStock: 0,
  },
};
