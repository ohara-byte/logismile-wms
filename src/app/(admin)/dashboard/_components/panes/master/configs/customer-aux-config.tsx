/**
 * 👤 顧客属性補助マスタ（Sprint Y-13 / 作業補助タブ）
 *
 * 個人/企業/置き配/誤配多発 等、特記事項を持つ顧客の補助情報。
 * 作業補助タブから CRUD。将来は検品時アラートにも反映予定。
 */

import type { MasterConfig } from '../master-types';
import type { ReactNode } from 'react';

interface CustomerAux extends Record<string, unknown> {
  id: number;
  customerName: string;
  customerKana: string | null;
  attrType: string;
  note: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const ATTR_LABELS: Record<string, { label: string; color: string }> = {
  corp: { label: '企業', color: 'bg-blue-900 text-blue-100' },
  personal: { label: '個人', color: 'bg-emerald-900 text-emerald-100' },
  leave_at_door: { label: '置き配', color: 'bg-amber-900 text-amber-100' },
  redelivery_alert: { label: '誤配・再配多発', color: 'bg-red-900 text-red-100' },
  attention: { label: '要注意', color: 'bg-red-900 text-red-100' },
  note: { label: 'メモ', color: 'bg-surface-base text-ink-subtle' },
};

function renderCustomerCell(r: Record<string, unknown>): ReactNode {
  const name = String(r.customerName ?? '');
  const kana = r.customerKana ? String(r.customerKana) : '';
  return (
    <div className="leading-tight">
      <div className="font-bold text-ink-strong text-sm truncate">{name}</div>
      {kana && (
        <div className="text-3xs text-ink-muted truncate">{kana}</div>
      )}
    </div>
  );
}

function renderAttrCell(r: Record<string, unknown>): ReactNode {
  const t = String(r.attrType ?? 'note');
  const m = ATTR_LABELS[t] ?? ATTR_LABELS.note;
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-3xs font-bold ${m.color}`}
    >
      {m.label}
    </span>
  );
}

export const customerAuxConfig: MasterConfig<CustomerAux> = {
  name: 'customer-aux',
  title: '👤 顧客属性補助',
  icon: '👤',
  endpoint: '/api/master/customer-aux',
  primaryKey: 'id',
  searchPlaceholder: '🔍 顧客名／カナ／備考で検索',
  hint:
    '注意が必要な顧客を補助情報として登録。検品時の警告表示や置き配判定に将来連携します。',
  filterField: 'attrType',
  filterPlaceholder: '─ 属性 ─',
  filterOptions: [
    { value: 'corp', label: '企業' },
    { value: 'personal', label: '個人' },
    { value: 'leave_at_door', label: '置き配' },
    { value: 'redelivery_alert', label: '誤配・再配多発' },
    { value: 'attention', label: '要注意' },
    { value: 'note', label: 'メモ' },
  ],
  columns: [
    {
      key: 'active',
      label: '状態',
      align: 'center',
      width: 56,
      render: (r) => (r.active ? '✓' : '✗'),
    },
    {
      key: 'customerName',
      label: '顧客名 / カナ',
      width: 240,
      render: (r) => renderCustomerCell(r as Record<string, unknown>),
    },
    {
      key: 'attrType',
      label: '属性',
      align: 'center',
      width: 120,
      render: (r) => renderAttrCell(r as Record<string, unknown>),
    },
    { key: 'note', label: '備考', truncate: true },
  ],
  formFields: [
    {
      name: 'customerName',
      label: '顧客名',
      type: 'text',
      required: true,
      placeholder: '例: 株式会社サンプル / 山田 太郎',
    },
    {
      name: 'customerKana',
      label: 'カナ',
      type: 'text',
      transform: 'kana',
      placeholder: 'カブシキガイシャサンプル（ひらがなで入力で自動変換）',
      helpText: 'ひらがな入力で自動カタカナ変換',
    },
    {
      name: 'attrType',
      label: '属性',
      type: 'select',
      required: true,
      options: [
        { value: 'corp', label: '企業' },
        { value: 'personal', label: '個人' },
        { value: 'leave_at_door', label: '置き配指定' },
        { value: 'redelivery_alert', label: '誤配・再配達多発' },
        { value: 'attention', label: '要注意' },
        { value: 'note', label: 'メモのみ' },
      ],
    },
    {
      name: 'note',
      label: '備考',
      type: 'textarea',
      placeholder: '例：玄関前の植木鉢の左に置き配 / 配送時に電話必須 など',
    },
    {
      name: 'active',
      label: '有効',
      type: 'boolean',
      helpText: 'OFF にすると検品時アラートから除外（履歴は保持）',
    },
  ],
  initialValues: { attrType: 'note', active: true },
};
