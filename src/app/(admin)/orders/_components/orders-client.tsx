'use client';

import { useEffect, useState } from 'react';
import { OrderDetailModal } from './order-detail-modal';

interface OrderRow {
  id: string;
  pkNo: string;
  shipDate: string;
  status: string;
  qrPrintFlag: boolean;
  invoiceNo: string | null;
  destName: string | null;
  carrier: { code: string; name: string; short: string | null; cool: boolean } | null;
  itemCount: number;
  scannedRatio: number;
  deletedAt: string | null;
}

const STATUS_OPTIONS = [
  { value: '', label: '全て' },
  { value: 'pending', label: '未着手' },
  { value: 'inspecting', label: '検品中' },
  { value: 'packed', label: '梱包完了' },
  { value: 'held', label: '保留' },
];

export function OrdersClient() {
  const [items, setItems] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  // フィルタ
  const [shipDate, setShipDate] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);

  // 詳細モーダル
  const [selected, setSelected] = useState<string | null>(null);

  // 納品書照合
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [invoiceMatch, setInvoiceMatch] = useState<OrderRow | null>(null);
  const [invoiceMsg, setInvoiceMsg] = useState<string | null>(null);

  async function reload() {
    setBusy(true);
    const params = new URLSearchParams();
    if (shipDate) params.set('shipDate', shipDate);
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    if (includeDeleted) params.set('includeDeleted', 'true');
    const res = await fetch(`/api/orders?${params}`);
    const j = await res.json();
    if (j.data) {
      setItems(j.data.items);
      setTotal(j.data.total);
    }
    setBusy(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onInvoiceSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceQuery.trim()) return;
    setInvoiceMsg(null);
    setInvoiceMatch(null);
    const params = new URLSearchParams({ q: invoiceQuery.trim(), limit: '5' });
    const res = await fetch(`/api/orders?${params}`);
    const j = await res.json();
    const matches: OrderRow[] = j.data?.items ?? [];
    const exact = matches.find((m) => m.invoiceNo === invoiceQuery.trim());
    if (exact) {
      setInvoiceMatch(exact);
      setInvoiceMsg(`✅ 納品書№ ${invoiceQuery} → ピッキング№ ${exact.pkNo}`);
    } else if (matches.length > 0) {
      setInvoiceMatch(matches[0]);
      setInvoiceMsg(`⚠ 完全一致なし。部分一致 ${matches.length} 件中先頭を表示`);
    } else {
      setInvoiceMsg('❌ 該当なし');
    }
  }

  return (
    <div className="space-y-4">
      {/* 納品書バーコード照合 */}
      <div className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-2 text-sm">📋 納品書バーコード照合</h2>
        <form onSubmit={onInvoiceSearch} className="flex gap-2">
          <input
            value={invoiceQuery}
            onChange={(e) => setInvoiceQuery(e.target.value)}
            placeholder="納品書№（バーコード or 手入力）"
            className="flex-1 border-2 rounded px-3 py-2 font-mono text-sm"
          />
          <button className="px-4 bg-blue-600 text-white rounded font-medium" type="submit">
            照合
          </button>
        </form>
        {invoiceMsg && (
          <div className="mt-2 text-sm">
            {invoiceMsg}
            {invoiceMatch && (
              <button
                className="ml-2 text-blue-600 hover:underline"
                onClick={() => setSelected(invoiceMatch.pkNo)}
              >
                詳細を表示
              </button>
            )}
          </div>
        )}
      </div>

      {/* フィルタ */}
      <div className="bg-white border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-500">出荷日</label>
            <input
              type="date"
              value={shipDate}
              onChange={(e) => setShipDate(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">ステータス</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-gray-500">検索（PkNo / 納品書 / 配送先）</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="例: SA01 / 鳥取 / 山田"
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-between items-center mt-3">
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => setIncludeDeleted(e.target.checked)}
            />
            🗑 削除済みも含める
          </label>
          <button
            onClick={reload}
            disabled={busy}
            className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm disabled:bg-gray-300"
          >
            {busy ? '…' : '検索'}
          </button>
        </div>
      </div>

      {/* 一覧 */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-gray-50 text-xs text-gray-600 border-b">
          {total} 件
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">出荷日</th>
              <th className="px-3 py-2 text-left">PkNo</th>
              <th className="px-3 py-2 text-left">運送</th>
              <th className="px-3 py-2 text-left">配送先</th>
              <th className="px-3 py-2 text-left">納品書</th>
              <th className="px-3 py-2 text-left">QR</th>
              <th className="px-3 py-2 text-left">状態</th>
              <th className="px-3 py-2 text-right">進捗</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                  該当する伝票がありません
                </td>
              </tr>
            )}
            {items.map((o) => (
              <tr
                key={o.id}
                className={`border-t hover:bg-blue-50 cursor-pointer ${
                  o.deletedAt ? 'bg-gray-50 text-gray-400' : ''
                }`}
                onClick={() => setSelected(o.pkNo)}
              >
                <td className="px-3 py-2">
                  {new Date(o.shipDate).toLocaleDateString('ja-JP')}
                </td>
                <td className="px-3 py-2 font-mono">{o.pkNo}</td>
                <td className="px-3 py-2 text-xs">
                  {o.carrier?.short ?? o.carrier?.name ?? '—'}
                  {o.carrier?.cool && ' ❄'}
                </td>
                <td className="px-3 py-2 truncate max-w-xs">{o.destName ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{o.invoiceNo ?? '—'}</td>
                <td className="px-3 py-2">{o.qrPrintFlag ? '🖨' : '—'}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={o.status} deleted={!!o.deletedAt} />
                </td>
                <td className="px-3 py-2 text-right">
                  {o.scannedRatio}% ({o.itemCount})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 詳細モーダル */}
      {selected && (
        <OrderDetailModal
          pkNo={selected}
          onClose={() => {
            setSelected(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status, deleted }: { status: string; deleted: boolean }) {
  if (deleted) {
    return <span className="text-xs bg-gray-300 text-gray-700 px-2 py-0.5 rounded">削除済</span>;
  }
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: '未着手', cls: 'bg-gray-100 text-gray-700' },
    inspecting: { label: '検品中', cls: 'bg-blue-100 text-blue-700' },
    packed: { label: '梱包完了', cls: 'bg-green-100 text-green-800' },
    shipped: { label: '出荷済', cls: 'bg-green-200 text-green-900' },
    held: { label: '保留', cls: 'bg-orange-100 text-orange-800' },
  };
  const m = map[status] ?? { label: status, cls: 'bg-gray-100' };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${m.cls}`}>{m.label}</span>
  );
}
