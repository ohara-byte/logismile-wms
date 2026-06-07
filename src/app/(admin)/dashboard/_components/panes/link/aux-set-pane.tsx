'use client';

/**
 * 🎁 親商品（構成＋同梱品） サブタブ（A-11b / Sprint Y-2 で名称変更）
 *
 * SetComp（親）+ SetCompChild（子）を CRUD。
 * 親商品＝受注単位（JANなし）の集合。子商品＝WMS連携単位（JAN付き構成商品）。
 *
 * 表示カラム:
 *   - 親コード／親商品名／種別／推奨箱
 *   - 子商品コード（カンマ区切り）／子商品名／子点数／標準時間（合計秒）
 */

import { MasterTable } from '../master/master-table';
import type { MasterConfig } from '../master/master-types';

interface SetCompChildSummary {
  id: number;
  childCode: string;
  childName: string | null;
  qty: number;
  stdSec: number | null;
}

interface SetComp extends Record<string, unknown> {
  id: string;
  parentCode: string;
  parentName: string;
  type: string;
  fixedBoxCode: string | null;
  fixedBoxName: string | null;
  packingNote: string | null;
  childCount: number;
  children: SetCompChildSummary[];
  childrenSummary: string;
  totalStdSec: number;
  note: string | null;
  updatedAt: string;
}

const config: MasterConfig<SetComp> = {
  name: 'aux-set',
  title: '🎁 親商品（構成＋同梱品）',
  icon: '🎁',
  endpoint: '/api/master/set-comps',
  primaryKey: 'id',
  searchPlaceholder: '🔍 ID／親商品コード／親商品名／子商品コードで検索',
  hint: '親商品＝受注単位の集合。子商品（構成商品）の組合せから親商品を逆算するため、子商品の情報を併せて表示します',
  filterField: 'type',
  filterPlaceholder: '─ 種別 ─',
  filterOptions: [
    { value: 'set', label: 'セット商品' },
    { value: 'koudoku', label: '同梱物' },
    { value: 'noshi', label: 'のし' },
    { value: 'other', label: 'その他' },
  ],
  columns: [
    { key: 'parentCode', label: '親コード', mono: true, width: 110 },
    { key: 'parentName', label: '親商品名', truncate: true, width: 200 },
    {
      key: 'type',
      label: '種別',
      width: 80,
      render: (r) =>
        r.type === 'set'
          ? 'セット'
          : r.type === 'koudoku'
            ? '同梱物'
            : r.type === 'noshi'
              ? 'のし'
              : r.type,
    },
    {
      key: 'fixedBoxCode',
      label: '推奨箱',
      width: 110,
      truncate: true,
      render: (r) =>
        r.fixedBoxCode
          ? `${r.fixedBoxCode}${r.fixedBoxName ? ` (${r.fixedBoxName})` : ''}`
          : '—',
    },
    // 子商品（構成商品）情報
    {
      key: 'childCodes',
      label: '子商品コード',
      mono: true,
      truncate: true,
      width: 160,
      render: (r) =>
        Array.isArray(r.children) && r.children.length > 0
          ? r.children
              .map((c) => `${c.childCode}${c.qty > 1 ? `×${c.qty}` : ''}`)
              .join(', ')
          : '—',
    },
    {
      key: 'childNames',
      label: '子商品名',
      truncate: true,
      width: 180,
      render: (r) =>
        Array.isArray(r.children) && r.children.length > 0
          ? r.children.map((c) => c.childName ?? '—').join(' / ')
          : '—',
    },
    {
      key: 'childCount',
      label: '点数',
      align: 'right',
      mono: true,
      width: 60,
    },
    {
      key: 'totalStdSec',
      label: '標準時間',
      align: 'right',
      mono: true,
      width: 90,
      render: (r) =>
        typeof r.totalStdSec === 'number' && r.totalStdSec > 0
          ? `${r.totalStdSec}s`
          : '—',
    },
    { key: 'updatedAt', label: '更新', mono: true, width: 90 },
  ],
  formFields: [
    { name: 'id', label: 'ID', type: 'text', required: true, readonlyOnEdit: true, helpText: 'ユニーク (例: SET-OE-2024)' },
    { name: 'parentCode', label: '親商品コード', type: 'text', required: true },
    { name: 'parentName', label: '親商品名', type: 'text', required: true },
    {
      name: 'type',
      label: '種別',
      type: 'select',
      required: true,
      options: [
        { value: 'set', label: 'セット商品' },
        { value: 'koudoku', label: '同梱物' },
        { value: 'noshi', label: 'のし' },
        { value: 'other', label: 'その他' },
      ],
    },
    { name: 'fixedBoxCode', label: '推奨箱コード', type: 'text', helpText: '箱マスタの code を指定' },
    { name: 'packingNote', label: '梱包メモ', type: 'textarea' },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: { type: 'set' },
};

export function AuxSetPane() {
  return <MasterTable config={config as unknown as MasterConfig<Record<string, unknown>>} />;
}
