/**
 * 📊 在庫マスタ（Sprint Z-1）
 *
 * SKU 単位の在庫サマリ。1 商品 1 行。
 *  - qty: 物理在庫
 *  - allocatedQty: 引当済（未出荷）
 *  - availableQty: 利用可能（qty - allocatedQty）
 *  - 補充推奨フラグ（reorderPoint との比較）
 */

import type { MasterConfig } from '../master-types';
import type { ReactNode } from 'react';

interface Stock extends Record<string, unknown> {
  productCode: string;
  productName: string;
  productJan: string | null;
  productCat: string;
  productType: string;
  qty: number;
  allocatedQty: number;
  availableQty: number;
  safetyStock: number;
  reorderPoint: number | null;
  needsReorder: boolean;
  inspectedAt: string | null;
  inspectedBy: string | null;
  updatedAt: string;
}

/** 商品名（太字）+ コード/JAN 2段表示 */
function renderNameCell(r: Record<string, unknown>): ReactNode {
  const name = String(r.productName ?? '');
  const code = String(r.productCode ?? '');
  const jan = r.productJan ? String(r.productJan) : '';
  return (
    <div className="leading-tight">
      <div className="font-bold text-ink-strong text-sm truncate">{name}</div>
      <div className="font-mono text-3xs text-ink-muted truncate">
        {code}
        {jan && ` / ${jan}`}
      </div>
    </div>
  );
}

/** 在庫数表示：qty / allocated / available の 3 段 */
function renderQtyCell(r: Record<string, unknown>): ReactNode {
  const qty = Number(r.qty ?? 0);
  const alloc = Number(r.allocatedQty ?? 0);
  const avail = Number(r.availableQty ?? 0);
  const needsReorder = Boolean(r.needsReorder);
  return (
    <div className="leading-tight font-mono tabular-nums">
      <div
        className={`text-sm font-bold ${
          avail <= 0 ? 'text-status-error' : needsReorder ? 'text-accent-amber' : 'text-status-ok'
        }`}
      >
        利用可 {avail}
      </div>
      <div className="text-3xs text-ink-muted">
        在庫 {qty} − 引当 {alloc}
      </div>
    </div>
  );
}

function renderTypeCell(r: Record<string, unknown>): ReactNode {
  const t = String(r.productType ?? '');
  if (t === 'pass_through') return <span className="text-cyan-300">通過型</span>;
  if (t === 'made_to_order') return <span className="text-accent-amber">受注生産</span>;
  return <span className="text-ink-subtle">倉庫在庫</span>;
}

export const stockConfig: MasterConfig<Stock> = {
  name: 'stock',
  title: '📊 在庫マスタ',
  icon: '📊',
  endpoint: '/api/master/stocks',
  primaryKey: 'productCode',
  searchPlaceholder: '🔍 商品コード／JAN／商品名で検索',
  hint: 'SKU 単位の在庫管理。引当済を下回る数量には変更不可。賞味期限管理は将来拡張で対応',
  filterField: 'productType',
  filterPlaceholder: '─ 種別 ─',
  filterOptions: [
    { value: 'warehouse', label: '倉庫在庫' },
    { value: 'pass_through', label: '通過型' },
    { value: 'made_to_order', label: '受注生産' },
  ],
  columns: [
    {
      key: 'productName',
      label: '商品 / コード',
      width: 240,
      truncate: true,
      render: (r) => renderNameCell(r as Record<string, unknown>),
    },
    {
      key: 'productType',
      label: '種別',
      width: 90,
      render: (r) => renderTypeCell(r as Record<string, unknown>),
    },
    { key: 'productCat', label: 'カテゴリ', width: 80 },
    {
      key: 'qty',
      label: '在庫状況',
      align: 'right',
      width: 140,
      render: (r) => renderQtyCell(r as Record<string, unknown>),
    },
    {
      key: 'safetyStock',
      label: '安全在庫',
      align: 'right',
      width: 80,
      mono: true,
    },
    {
      key: 'reorderPoint',
      label: '補充点',
      align: 'right',
      width: 80,
      mono: true,
      render: (r) => (r.reorderPoint != null ? String(r.reorderPoint) : '—'),
    },
    {
      key: 'inspectedAt',
      label: '最終検品',
      width: 110,
      mono: true,
      render: (r) => {
        const v = r.inspectedAt as string | null;
        if (!v) return '—';
        const d = new Date(v);
        return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      },
    },
  ],
  formFields: [
    {
      name: 'productCode',
      label: '商品コード',
      type: 'text',
      required: true,
      readonlyOnEdit: true,
      helpText: '構成商品マスタに登録済の商品コードを指定',
    },
    {
      name: 'qty',
      label: '在庫数',
      type: 'number',
      min: 0,
      required: true,
      helpText: '物理カウント値。引当済を下回る数量には変更不可',
    },
    {
      name: 'note',
      label: '備考',
      type: 'textarea',
      placeholder: '修正理由・棚卸メモ等',
    },
  ],
  initialValues: { qty: 0 },
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
