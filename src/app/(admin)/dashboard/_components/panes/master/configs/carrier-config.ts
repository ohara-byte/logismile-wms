import type { MasterConfig } from '../master-types';

interface Carrier extends Record<string, unknown> {
  code: string;
  name: string;
  short: string | null;
  priority: number;
  cutoff: string | null;
  pickup: string | null;
  cool: boolean;
  wbType: string | null;
  contact: string | null;
  active: boolean;
  note: string | null;
}

export const carrierConfig: MasterConfig<Carrier> = {
  name: 'carrier',
  title: '🚚 運送会社マスタ',
  icon: '🚚',
  endpoint: '/api/master/carriers',
  primaryKey: 'code',
  searchPlaceholder: '🔍 コード／名称／略称で検索',
  hint: '運送会社マスタは伝票の便種・残件カードに使われます',
  filterField: 'cool',
  filterPlaceholder: '─ 温度帯 ─',
  filterOptions: [
    { value: 'true', label: '冷凍便のみ' },
    { value: 'false', label: '常温便のみ' },
  ],
  columns: [
    { key: 'code', label: 'コード', mono: true, width: 90 },
    { key: 'name', label: '名称' },
    { key: 'short', label: '略称', width: 80 },
    {
      key: 'cool',
      label: '冷凍',
      align: 'center',
      width: 56,
      render: (r) => (r.cool ? '❄' : ''),
    },
    { key: 'pickup', label: '集荷', width: 70, mono: true },
    { key: 'cutoff', label: '締切', width: 70, mono: true },
    { key: 'priority', label: '優先度', align: 'right', width: 70 },
    {
      key: 'active',
      label: '有効',
      align: 'center',
      width: 56,
      render: (r) => (r.active ? '✓' : '○'),
    },
  ],
  formFields: [
    { name: 'code', label: 'コード', type: 'text', required: true, readonlyOnEdit: true, helpText: '英数字 20 文字以内（重複不可）' },
    { name: 'name', label: '名称', type: 'text', required: true },
    { name: 'short', label: '略称', type: 'text', placeholder: '例: ヤマト' },
    { name: 'priority', label: '優先度', type: 'number', min: 1, max: 999, helpText: '昇順表示。小さいほど上に表示' },
    { name: 'pickup', label: '集荷時刻', type: 'text', placeholder: 'HH:MM (例: 17:30)' },
    { name: 'cutoff', label: '締切時刻', type: 'text', placeholder: 'HH:MM' },
    { name: 'cool', label: '冷凍便', type: 'boolean' },
    { name: 'wbType', label: '送り状タイプ', type: 'text' },
    { name: 'contact', label: '連絡先', type: 'text' },
    { name: 'active', label: '有効', type: 'boolean' },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: { priority: 50, active: true, cool: false },
};
