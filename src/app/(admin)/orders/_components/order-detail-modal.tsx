'use client';

import { useEffect, useState } from 'react';

interface OrderDetail {
  id: string;
  pkNo: string;
  shipDate: string;
  status: string;
  qrPrintFlag: boolean;
  invoiceNo: string | null;
  noshiName: string | null;
  destName: string | null;
  destZip: string | null;
  destAddr: string | null;
  holdReason: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
  carrier: { code: string; name: string; short: string | null; cool: boolean } | null;
  items: Array<{
    id: number;
    productCode: string;
    productName: string;
    qty: number;
    scannedQty: number;
    forceOk: boolean;
    forceReason: string | null;
    product: { jan: string | null };
  }>;
}

interface Props {
  pkNo: string;
  onClose: () => void;
}

export function OrderDetailModal({ pkNo, onClose }: Props) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/orders/${encodeURIComponent(pkNo)}`);
    const j = await res.json();
    if (res.ok) setOrder(j.data);
    else setError(j.message ?? `HTTP ${res.status}`);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkNo]);

  async function onTogglePrintFlag() {
    if (!order) return;
    setBusy(true);
    await fetch(`/api/orders/${encodeURIComponent(order.pkNo)}/print-flag`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr_print_flag: !order.qrPrintFlag }),
    });
    setBusy(false);
    load();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-3 flex justify-between items-center">
          <h2 className="text-lg font-bold font-mono">{pkNo}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-700 p-3 rounded">{error}</div>}
          {!order ? (
            <div className="text-gray-500">読み込み中…</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="出荷日" value={new Date(order.shipDate).toLocaleDateString('ja-JP')} />
                <Field label="状態" value={order.status} />
                <Field
                  label="運送会社"
                  value={`${order.carrier?.name ?? '—'}${order.carrier?.cool ? ' ❄' : ''}`}
                />
                <Field label="納品書№" value={order.invoiceNo ?? '—'} />
                <Field label="のし" value={order.noshiName ?? '—'} />
                <div>
                  <div className="text-xs text-gray-500">QR印刷フラグ</div>
                  <button
                    onClick={onTogglePrintFlag}
                    disabled={busy}
                    className={`px-3 py-1 rounded text-sm font-medium ${
                      order.qrPrintFlag ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    {order.qrPrintFlag ? '🖨 ON' : '○ OFF'}
                  </button>
                </div>
              </div>

              <Field label="配送先" value={`${order.destName ?? '—'} / ${order.destZip ?? ''} ${order.destAddr ?? ''}`} />

              {order.deletedAt && (
                <div className="bg-red-50 border border-red-200 rounded p-3 text-sm">
                  <div className="font-medium text-red-800">🗑 削除済み</div>
                  <div className="text-xs text-red-700 mt-1">
                    {new Date(order.deletedAt).toLocaleString('ja-JP')} / {order.deletedBy}
                  </div>
                  <div className="text-xs text-red-700">{order.deleteReason}</div>
                </div>
              )}

              {order.holdReason && (
                <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm">
                  <div className="font-medium text-orange-800">⏸ 保留</div>
                  <div className="text-xs text-orange-700">{order.holdReason}</div>
                </div>
              )}

              <div>
                <h3 className="font-semibold text-sm mb-2">商品 ({order.items.length})</h3>
                <table className="w-full text-sm border">
                  <thead className="bg-gray-50 text-xs">
                    <tr>
                      <th className="px-2 py-1 text-left">商品名</th>
                      <th className="px-2 py-1 text-left">JAN</th>
                      <th className="px-2 py-1 text-right">指示</th>
                      <th className="px-2 py-1 text-right">スキャン</th>
                      <th className="px-2 py-1">強制</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((it) => (
                      <tr key={it.id} className="border-t">
                        <td className="px-2 py-1">
                          <div>{it.productName}</div>
                          <div className="text-xs text-gray-500 font-mono">{it.productCode}</div>
                        </td>
                        <td className="px-2 py-1 font-mono text-xs">{it.product.jan ?? '—'}</td>
                        <td className="px-2 py-1 text-right">{it.qty}</td>
                        <td className="px-2 py-1 text-right">
                          <span
                            className={
                              it.forceOk || it.scannedQty >= it.qty
                                ? 'text-green-700 font-medium'
                                : ''
                            }
                          >
                            {it.scannedQty}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-center">
                          {it.forceOk ? (
                            <span className="text-xs text-yellow-700" title={it.forceReason ?? ''}>
                              ⚠
                            </span>
                          ) : (
                            ''
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div>{value}</div>
    </div>
  );
}
