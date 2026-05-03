'use client';

/**
 * 🎁 構成品/同梱物 サブタブ（A-11b）
 *
 * SetComp（親）を CRUD。子（SetCompChild）は将来オプション。
 */

import { MasterTable } from '../master/master-table';
import type { MasterConfig } from '../master/master-types';

interface SetComp extends Record<string, unknown> {
  id: string;
  parentCode: string;
  parentName: string;
  type: string;
  fixedBoxCode: string | null;
  fixedBoxName: string | null;
  packingNote: string | null;
  childCount: number;
  note: string | null;
  updatedAt: string;
}

const config: MasterConfig<SetComp> = {
  name: 'aux-set',
  title: '🎁 構成品 / 同梱物',
  icon: '🎁',
  endpoint: '/api/master/set-comps',
  primaryKey: 'id',
  searchPlaceholder: '🔍 ID／親商品コード／親商品名で検索',
  hint: 'セット商品の構成品定義。固定箱を指定すると検品時に自動推奨される',
  filterField: 'type',
  filterPlaceholder: '─ 種別 ─',
  filterOptions: [
    { value: 'set', label: 'セット商品' },
    { value: 'koudoku', label: '同梱物' },
    { value: 'noshi', label: 'のし' },
    { value: 'other', label: 'その他' },
  ],
  columns: [
    { key: 'id', label: 'ID', mono: true, width: 130 },
    { key: 'parentCode', label: '親コード', mono: true, width: 110 },
    { key: 'parentName', label: '親商品名', truncate: true },
    {
      key: 'type',
      label: '種別',
      width: 90,
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
      width: 130,
      truncate: true,
      render: (r) =>
        r.fixedBoxCode
          ? `${r.fixedBoxCode}${r.fixedBoxName ? ` (${r.fixedBoxName})` : ''}`
          : '—',
    },
    { key: 'childCount', label: '子点数', align: 'right', mono: true, width: 70 },
    { key: 'updatedAt', label: '更新', mono: true, width: 100 },
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
