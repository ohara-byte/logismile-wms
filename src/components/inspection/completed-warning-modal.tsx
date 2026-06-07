'use client';

/**
 * 検品済み伝票 再読込警告モーダル（タブレット / ハンディ共用）
 *
 * モック準拠（タブレット検品モック_v0.18.html L1529-1551）。
 *
 * 待機画面で検品/梱包完了済みの伝票がスキャンされたときに表示。
 * 「検品戻し（再検品）」または「確認」を選択。
 *
 * 検品戻しは POST /api/inspect/reopen を呼ぶ（status を inspecting に戻す）。
 * 操作はすべて order_audit_logs に記録される。
 */

import { useEffect, useState } from 'react';

interface CompletedOrderInfo {
  pkNo: string;
  invoiceNo: string | null;
  destName: string | null;
  completedAt: string | null;
  staffName: string | null;
  itemCount: number;
}

interface Props {
  open: boolean;
  order: CompletedOrderInfo | null;
  onConfirm: () => void;
  onReopen: () => Promise<void> | void;
  onCancel: () => void;
}

export function CompletedWarningModal({
  open,
  order,
  onConfirm,
  onReopen,
  onCancel,
}: Props) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open || !order) return null;

  async function handleReopen() {
    setBusy(true);
    try {
      await onReopen();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="bg-surface-panel border-2 border-status-info rounded-2xl shadow-modal max-w-lg w-full p-5">
        <h2 className="text-lg font-bold text-status-info mb-1">✓ 検品済みです</h2>
        <p className="text-2xs text-ink-subtle mb-3 leading-snug">
          この伝票は既に検品・梱包が完了しています。再度処理する場合は
          <b className="text-status-warn">「検品戻し」</b>
          を押してください（操作はログに記録されます）。
        </p>

        <div className="bg-status-info-bg border-l-4 border-status-info rounded p-3 mb-4">
          <Field
            k="ピッキングNo"
            v={<span className="font-mono text-accent-amber">{order.pkNo}</span>}
          />
          <Field
            k="納品書No"
            v={<span className="font-mono">{order.invoiceNo ?? '—'}</span>}
          />
          <Field k="お届け先" v={order.destName ?? '—'} />
          <Field
            k="完了時刻"
            v={
              order.completedAt ? (
                <span className="text-status-info">
                  {new Date(order.completedAt).toLocaleString('ja-JP')}
                </span>
              ) : (
                '—'
              )
            }
          />
          <Field k="作業者" v={order.staffName ?? '—'} />
          <Field k="点数" v={`${order.itemCount} 点`} />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={handleReopen}
            disabled={busy}
            className="px-3 py-2 rounded bg-amber-700 text-white text-xs font-bold flex items-center gap-1 hover:bg-amber-600 disabled:opacity-50"
          >
            <span>↻</span> {busy ? '処理中…' : '検品戻し（再検品）'}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-3 py-2 rounded bg-status-info text-white text-xs font-bold flex items-center gap-1 hover:brightness-110 disabled:opacity-50"
          >
            <span>✓</span> 確認
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-1.5 text-xs leading-relaxed">
      <span className="text-ink-subtle">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  );
}
