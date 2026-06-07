'use client';

/**
 * 検品引き継ぎ確認モーダル（タブレット / ハンディ共用）
 *
 * 2026-05-31 現場要望：
 *   別担当者が検品中（status='inspecting'）の伝票を別端末でスキャンしたときに表示。
 *   「引き継ぐ」「やめる」の 2 択。
 *
 * 別担当者の検品セッションを引き継ぐ意思表示を明示するためのワンクッション。
 * 同様パターンの保留中（held）は確認なしで自動引き継ぎ（HeldResumeModal の方で扱う）。
 */

import { useEffect } from 'react';

interface InspectingOrderInfo {
  pkNo: string;
  invoiceNo: string | null;
  destName: string | null;
  currentOwnerName: string | null;
  currentOwnerCode: string | null;
  scannedRatio: number;
  itemCount: number;
}

interface Props {
  open: boolean;
  order: InspectingOrderInfo | null;
  onTakeover: () => void;
  onCancel: () => void;
}

export function TakeoverConfirmModal({ open, order, onTakeover, onCancel }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open || !order) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-surface-panel border-2 border-accent-amber rounded-2xl shadow-modal max-w-lg w-full p-5">
        <h2 className="text-lg font-bold text-accent-amber mb-1">
          ⇄ 他の担当者が検品中
        </h2>
        <p className="text-2xs text-ink-subtle mb-3 leading-snug">
          この伝票は<b className="text-status-warn">他の担当者が検品中</b>です。
          引き継いで作業を続けると、元の担当者の画面では操作できなくなります。
        </p>

        <div className="bg-accent-amber/10 border-l-4 border-accent-amber rounded p-3 mb-4">
          <Field
            k="ピッキングNo"
            v={
              <span className="font-mono text-accent-amber">{order.pkNo}</span>
            }
          />
          <Field
            k="納品書No"
            v={
              <span className="font-mono">
                {order.invoiceNo ?? '— （未確定）'}
              </span>
            }
          />
          <Field k="お届け先" v={order.destName ?? '—'} />
          <Field
            k="現在の担当"
            v={
              <span className="text-status-warn font-bold">
                {order.currentOwnerName ?? order.currentOwnerCode ?? '—'}
              </span>
            }
          />
          <Field
            k="進捗"
            v={
              <span className="text-status-ok font-bold">
                {order.scannedRatio}% （{order.itemCount} 点中）
              </span>
            }
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded border border-surface-border bg-surface-base text-ink text-xs"
          >
            やめる
          </button>
          <button
            onClick={onTakeover}
            className="px-3 py-2 rounded bg-accent-amber text-white text-xs font-bold flex items-center gap-1 hover:brightness-110"
          >
            <span>⇄</span> 引き継いで検品
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
