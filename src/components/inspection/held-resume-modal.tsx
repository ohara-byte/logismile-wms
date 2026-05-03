'use client';

/**
 * 保留中伝票 復帰モーダル（タブレット / ハンディ共用）
 *
 * モック準拠（タブレット検品モック_v0.18.html L1503-1527）。
 *
 * 待機画面で保留中の伝票がスキャンされたときに表示。
 * 「続きから」「最初から」「キャンセル」の 3 択。
 *
 * 続きから / 最初から はいずれも検品画面に遷移するが、
 * 復帰モードを query parameter で渡して挙動を切替可能（resume / restart）。
 */

import { useEffect } from 'react';

interface HeldOrderInfo {
  pkNo: string;
  invoiceNo: string | null;
  destName: string | null;
  holdReason: string | null;
  scannedRatio: number;
  itemCount: number;
}

interface Props {
  open: boolean;
  order: HeldOrderInfo | null;
  onResume: () => void;
  onRestart: () => void;
  onCancel: () => void;
}

export function HeldResumeModal({ open, order, onResume, onRestart, onCancel }: Props) {
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
      <div className="bg-surface-panel border border-status-warn rounded-2xl shadow-modal max-w-lg w-full p-5">
        <h2 className="text-lg font-bold text-status-warn mb-1">⏸ 保留中の伝票です</h2>
        <p className="text-2xs text-ink-subtle mb-3 leading-snug">
          この伝票は保留中で、
          <b className="text-status-ok">スキャン状態が保持</b>されています。
          「続きから」を選ぶと前回の状態を復元します。
        </p>

        <div className="bg-surface-base border-l-4 border-status-warn rounded p-3 mb-4">
          <Field k="ピッキングNo" v={<span className="font-mono text-accent-amber">{order.pkNo}</span>} />
          <Field
            k="納品書No"
            v={
              <span className="font-mono">
                {order.invoiceNo ?? '— （未確定）'}
              </span>
            }
          />
          <Field k="お届け先" v={order.destName ?? '—'} />
          <Field k="保留理由" v={<span className="text-status-warn">{order.holdReason ?? '—'}</span>} />
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
            キャンセル
          </button>
          <button
            onClick={onRestart}
            className="px-3 py-2 rounded bg-amber-700 text-white text-xs font-bold flex items-center gap-1 hover:bg-amber-600"
          >
            <span>↻</span> 最初から検品
          </button>
          <button
            onClick={onResume}
            className="px-3 py-2 rounded bg-status-ok text-white text-xs font-bold flex items-center gap-1 hover:bg-emerald-600"
          >
            <span>▶</span> 続きから検品
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
