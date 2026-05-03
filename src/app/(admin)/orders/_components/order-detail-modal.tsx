'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

interface AuditLog {
  id: number;
  action: string;
  actedAt: string;
  reason: string | null;
  diff: unknown;
  staff: { code: string; name: string };
}

interface Props {
  pkNo: string;
  onClose: () => void;
}

export function OrderDetailModal({ pkNo, onClose }: Props) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  async function load() {
    const res = await fetch(`/api/orders/${encodeURIComponent(pkNo)}`);
    const j = await res.json();
    if (res.ok) setOrder(j.data);
    else setError(j.message ?? `HTTP ${res.status}`);
  }
  async function loadAuditLogs() {
    const res = await fetch(`/api/orders/${encodeURIComponent(pkNo)}/audit-logs`);
    const j = await res.json();
    if (res.ok) setAuditLogs(j.data?.items ?? []);
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

  async function onDelete() {
    if (!order) return;
    const reason = prompt('削除理由を入力してください（必須）');
    if (!reason) return;
    setBusy(true);
    const res = await fetch(`/api/orders/${encodeURIComponent(order.pkNo)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    setBusy(false);
    if (res.ok) load();
    else alert((await res.json()).message ?? `エラー: HTTP ${res.status}`);
  }

  async function onRestore() {
    if (!order) return;
    const reason = prompt('復活理由を入力してください（必須）');
    if (!reason) return;
    setBusy(true);
    const res = await fetch(`/api/orders/${encodeURIComponent(order.pkNo)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    setBusy(false);
    if (res.ok) load();
    else alert((await res.json()).message ?? `エラー: HTTP ${res.status}`);
  }

  return (
    <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-40 p-4 backdrop-blur-sm">
      <div className="bg-surface-panel border border-surface-border rounded-2xl shadow-modal max-w-3xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-surface-panel border-b border-surface-border px-5 py-3 flex justify-between items-center">
          <div className="flex items-baseline gap-2">
            <span className="text-3xs text-ink-subtle uppercase">PkNo</span>
            <h2 className="text-base font-bold font-mono text-accent-amber tabular-nums">
              {pkNo}
            </h2>
          </div>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink-strong text-xl">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-3">
          {error && (
            <div className="bg-status-error-bg border border-status-error/40 text-status-error rounded p-3 text-sm">
              {error}
            </div>
          )}
          {!order ? (
            <div className="text-ink-muted text-sm">読み込み中…</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Field label="出荷日" value={new Date(order.shipDate).toLocaleDateString('ja-JP')} />
                <Field
                  label="状態"
                  value={
                    <Badge
                      variant={
                        order.status === 'packed'
                          ? 'done'
                          : order.status === 'inspecting'
                            ? 'working'
                            : order.status === 'held'
                              ? 'warn'
                              : 'wait'
                      }
                      size="md"
                    >
                      {order.status}
                    </Badge>
                  }
                />
                <Field
                  label="運送会社"
                  value={`${order.carrier?.name ?? '—'}${order.carrier?.cool ? ' ❄' : ''}`}
                />
                <Field
                  label="納品書№"
                  value={
                    <span className="font-mono tabular-nums">{order.invoiceNo ?? '—'}</span>
                  }
                />
                <Field label="のし" value={order.noshiName ?? '—'} />
                <div>
                  <div className="text-3xs text-ink-subtle uppercase tracking-wider mb-1">
                    QR印刷フラグ
                  </div>
                  <button
                    onClick={onTogglePrintFlag}
                    disabled={busy || !!order.deletedAt}
                    className={`px-3 py-1 rounded text-xs font-bold border ${
                      order.qrPrintFlag
                        ? 'bg-pink-700 border-pink-500 text-white'
                        : 'bg-surface-base border-surface-border text-ink-subtle'
                    } disabled:opacity-50`}
                  >
                    {order.qrPrintFlag ? '🖨 ON' : '○ OFF'}
                  </button>
                </div>
              </div>

              <Field
                label="配送先"
                value={`${order.destName ?? '—'} / ${order.destZip ?? ''} ${order.destAddr ?? ''}`}
              />

              {order.deletedAt && (
                <div className="bg-status-error-bg border border-status-error/40 rounded p-3 text-sm">
                  <div className="font-bold text-status-error">🗑 削除済み</div>
                  <div className="text-2xs text-red-300 mt-1">
                    {new Date(order.deletedAt).toLocaleString('ja-JP')} / {order.deletedBy}
                  </div>
                  <div className="text-2xs text-red-300">{order.deleteReason}</div>
                </div>
              )}

              {order.holdReason && (
                <div className="bg-status-warn-bg border border-status-warn/40 rounded p-3 text-sm">
                  <div className="font-bold text-status-warn">⏸ 保留</div>
                  <div className="text-2xs text-amber-300">{order.holdReason}</div>
                </div>
              )}

              <div>
                <h3 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-2">
                  商品 ({order.items.length})
                </h3>
                <div className="border border-surface-border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-base border-b border-surface-border">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-3xs uppercase text-ink-subtle">
                          商品名
                        </th>
                        <th className="px-2 py-1.5 text-left text-3xs uppercase text-ink-subtle">
                          JAN
                        </th>
                        <th className="px-2 py-1.5 text-right text-3xs uppercase text-ink-subtle">
                          指示
                        </th>
                        <th className="px-2 py-1.5 text-right text-3xs uppercase text-ink-subtle">
                          スキャン
                        </th>
                        <th className="px-2 py-1.5 text-center text-3xs uppercase text-ink-subtle">
                          強制
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((it) => (
                        <tr key={it.id} className="border-t border-surface-border">
                          <td className="px-2 py-1.5">
                            <div className="text-ink-strong">{it.productName}</div>
                            <div className="text-3xs text-ink-muted font-mono">
                              {it.productCode}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 font-mono text-2xs text-ink-subtle">
                            {it.product.jan ?? '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{it.qty}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            <span
                              className={
                                it.forceOk || it.scannedQty >= it.qty
                                  ? 'text-status-ok font-bold'
                                  : 'text-ink'
                              }
                            >
                              {it.scannedQty}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {it.forceOk && (
                              <span className="text-status-warn" title={it.forceReason ?? ''}>
                                ⚠
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 操作ボタン */}
              <div className="border-t border-surface-border pt-3 flex flex-wrap gap-2 justify-between items-center">
                <button
                  onClick={() => {
                    if (!showAuditLogs) loadAuditLogs();
                    setShowAuditLogs((s) => !s);
                  }}
                  className="text-xs text-status-info hover:underline"
                >
                  📜 監査ログ {showAuditLogs ? '隠す' : '表示'}
                </button>
                <div className="flex gap-2">
                  {order.deletedAt ? (
                    <Button onClick={onRestore} disabled={busy} variant="success">
                      ♻ 復活
                    </Button>
                  ) : (
                    <Button
                      onClick={onDelete}
                      disabled={busy || order.status === 'inspecting'}
                      variant="danger"
                      title={
                        order.status === 'inspecting'
                          ? '検品中の伝票は削除できません（先に保留へ）'
                          : ''
                      }
                    >
                      🗑 削除
                    </Button>
                  )}
                </div>
              </div>

              {showAuditLogs && (
                <div className="border border-surface-border rounded-lg p-3 bg-surface-base">
                  <h3 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-2">
                    監査ログ ({auditLogs.length})
                  </h3>
                  {auditLogs.length === 0 ? (
                    <p className="text-xs text-ink-muted">操作履歴はありません</p>
                  ) : (
                    <ul className="space-y-2 text-xs">
                      {auditLogs.map((log) => (
                        <li
                          key={log.id}
                          className="border-l-2 border-status-info pl-2"
                        >
                          <div>
                            <span className="font-mono font-bold text-status-info">
                              {log.action}
                            </span>{' '}
                            <span className="text-ink-subtle">
                              by {log.staff.name} ({log.staff.code})
                            </span>
                          </div>
                          <div className="text-ink-muted text-2xs">
                            {new Date(log.actedAt).toLocaleString('ja-JP')}
                          </div>
                          {log.reason && (
                            <div className="text-ink">理由: {log.reason}</div>
                          )}
                          {log.diff !== null && log.diff !== undefined && (
                            <details>
                              <summary className="cursor-pointer text-ink-subtle text-2xs">
                                差分
                              </summary>
                              <pre className="bg-surface-panel border border-surface-border p-1.5 mt-1 rounded text-3xs overflow-x-auto text-ink">
                                {JSON.stringify(log.diff, null, 2)}
                              </pre>
                            </details>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-3xs text-ink-subtle uppercase tracking-wider">{label}</div>
      <div className="text-ink-strong text-sm">{value}</div>
    </div>
  );
}
