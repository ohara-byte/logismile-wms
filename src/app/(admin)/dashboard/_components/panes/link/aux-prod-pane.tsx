'use client';

/**
 * 📦 商品属性補助 サブタブ（A-11b）
 *
 * MasterTable を再利用して ProductAuxAttr を CRUD。
 */

import { MasterTable } from '../master/master-table';
import type { MasterConfig } from '../master/master-types';

interface ProductAux extends Record<string, unknown> {
  productCode: string;
  productName: string;
  productJan: string | null;
  dispName: string | null;
  tempZone: string;
  specialPkg: string | null;
  stdSec: number;
  transferred: boolean;
  wMm: number;
  dMm: number;
  hMm: number;
  note: string | null;
}

const config: MasterConfig<ProductAux> = {
  name: 'aux-prod',
  title: '📦 商品属性補助',
  icon: '📦',
  endpoint: '/api/master/product-aux',
  primaryKey: 'productCode',
  searchPlaceholder: '🔍 コード／名称／JANで検索',
  hint: '基幹商品マスタを補完。冷凍・特殊梱包・標準時間・外寸 (W×D×H) 等を WMS 拡張属性として管理',
  filterField: 'tempZone',
  filterPlaceholder: '─ 温度帯 ─',
  filterOptions: [
    { value: 'ambient', label: '常温' },
    { value: 'cool', label: '冷蔵' },
    { value: 'frozen', label: '冷凍' },
  ],
  columns: [
    { key: 'productCode', label: 'コード', mono: true, width: 110 },
    { key: 'productName', label: '商品名', truncate: true },
    { key: 'productJan', label: 'JAN', mono: true, width: 130 },
    {
      key: 'tempZone',
      label: '温度帯',
      width: 80,
      render: (r) =>
        r.tempZone === 'ambient' ? '常温' : r.tempZone === 'cool' ? '冷蔵' : '冷凍',
    },
    { key: 'specialPkg', label: '特殊', width: 90, truncate: true },
    {
      key: 'size',
      label: '外寸 (mm)',
      mono: true,
      width: 130,
      render: (r) => `${r.wMm}×${r.dMm}×${r.hMm}`,
    },
    {
      key: 'stdSec',
      label: '標準秒',
      align: 'right',
      mono: true,
      width: 80,
    },
  ],
  formFields: [
    { name: 'productCode', label: '商品コード', type: 'text', required: true, readonlyOnEdit: true },
    { name: 'dispName', label: '表示名（任意）', type: 'text' },
    {
      name: 'tempZone',
      label: '温度帯',
      type: 'select',
      required: true,
      options: [
        { value: 'ambient', label: '常温' },
        { value: 'cool', label: '冷蔵' },
        { value: 'frozen', label: '冷凍' },
      ],
    },
    { name: 'specialPkg', label: '特殊梱包', type: 'text', placeholder: '例: 緩衝材厚め' },
    { name: 'stdSec', label: '標準時間（秒）', type: 'number', min: 0 },
    { name: 'transferred', label: '小分け済', type: 'boolean' },
    { name: 'wMm', label: '外寸 W (mm)', type: 'number', min: 0 },
    { name: 'dMm', label: '外寸 D (mm)', type: 'number', min: 0 },
    { name: 'hMm', label: '外寸 H (mm)', type: 'number', min: 0 },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: { tempZone: 'ambient', stdSec: 0, transferred: false, wMm: 0, dMm: 0, hMm: 0 },
};

export function AuxProdPane() {
  return <MasterTable config={config as unknown as MasterConfig<Record<string, unknown>>} />;
}
