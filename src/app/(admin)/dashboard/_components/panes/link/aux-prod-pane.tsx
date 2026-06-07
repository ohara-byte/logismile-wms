'use client';

/**
 * 📦 構成商品属性補助 サブタブ（A-11b / Sprint Y-2 で名称変更）
 *
 * MasterTable を再利用して ProductAuxAttr を CRUD。
 * 外寸はマスタに合わせ タテ(D) / 横(W) / 高(H) の 3 カラムに分割表示。
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
  title: '📦 構成商品属性補助',
  icon: '📦',
  endpoint: '/api/master/product-aux',
  primaryKey: 'productCode',
  searchPlaceholder: '🔍 コード／名称／JANで検索',
  hint: '基幹商品マスタを補完。冷凍・特殊梱包・標準時間・外寸（タテ/横/高）等を WMS 拡張属性として管理',
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
    // Sprint Y-2: 外寸はマスタに合わせ タテ／横／高 の 3 カラムに分割
    { key: 'dMm', label: 'タテ(mm)', align: 'right', mono: true, width: 80 },
    { key: 'wMm', label: '横(mm)', align: 'right', mono: true, width: 80 },
    { key: 'hMm', label: '高(mm)', align: 'right', mono: true, width: 80 },
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
    { name: 'dMm', label: '外寸 タテ (mm)', type: 'number', min: 0, helpText: '奥行き（D）' },
    { name: 'wMm', label: '外寸 横 (mm)', type: 'number', min: 0, helpText: '幅（W）' },
    { name: 'hMm', label: '外寸 高 (mm)', type: 'number', min: 0, helpText: '高さ（H）' },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: { tempZone: 'ambient', stdSec: 0, transferred: false, wMm: 0, dMm: 0, hMm: 0 },
};

export function AuxProdPane() {
  return <MasterTable config={config as unknown as MasterConfig<Record<string, unknown>>} />;
}
