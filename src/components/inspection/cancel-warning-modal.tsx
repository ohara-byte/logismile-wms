'use client';

/**
 * キャンセル（論理削除）伝票 警告モーダル（タブレット / ハンディ共用）
 *
 * 2026-05-22 新規:
 *   待機画面でキャンセル伝票（deletedAt != null）をスキャンしたとき、
 *   現場の誤作業防止のため赤背景で前面表示する。
 *
 * 動作:
 *   - 操作系は「閉じる」のみ（検品画面へは遷移させない）
 *   - Esc / 背景クリックで閉じる
 *   - 削除日時 / 削除者 / 削除理由 を表示し、原因把握を助ける
 */

import { useEffect } from 'react';

interface CancelOrderInfo {
  pkNo: string;
  invoiceNo: string | null;
  destName: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
}

interface Props {
  open: boolean;
  order: CancelOrderInfo | null;
  onClose: () => void;
}

export function CancelWarningModal({ open, order, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !order) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-panel border-2 border-status-error rounded-2xl shadow-modal max-w-lg w-full p-5">
        <h2 className="text-lg font-bold text-status-error mb-1">⛔ キャンセル伝票です</h2>
        <p className="text-2xs text-ink-subtle mb-3 leading-snug">
          この伝票は <b className="text-status-error">取消・削除済</b> です。
          検品はできません。「閉じる」を押してから次の伝票をスキャンしてください。
        </p>

        <div className="bg-status-error-bg border-l-4 border-status-error rounded p-3 mb-4">
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
            k="削除日時"
            v={
              order.deletedAt ? (
                <span className="text-status-error">
                  {new Date(order.deletedAt).toLocaleString('ja-JP')}
                </span>
              ) : (
                '—'
              )
            }
          />
          <Field k="削除者" v={order.deletedBy ?? '—'} />
          <Field
            k="削除理由"
            v={<span className="text-status-error">{order.deleteReason ?? '—'}</span>}
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            autoFocus
            className="px-4 py-2 rounded bg-status-error text-white text-xs font-bold hover:brightness-110"
          >
            閉じる
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
