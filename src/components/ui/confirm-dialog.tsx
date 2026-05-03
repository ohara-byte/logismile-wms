'use client';

/**
 * 汎用 確認ダイアログ
 *
 * モック準拠（管理用PCモック_v0.22.html L4734-4743 confirmModal）。
 *
 * 用途:
 *   - シンプル確認（yes/no）
 *   - 理由入力付き確認（promptLabel を渡すと textarea を表示し、入力必須）
 *
 * Esc / 背景クリックでキャンセル可能。
 */

import { useEffect, useState } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger' | 'warn' | 'success';
  /** 値を入れると textarea が表示され、入力必須になる */
  promptLabel?: string;
  promptPlaceholder?: string;
  promptInitial?: string;
  onConfirm: (promptValue: string) => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = '実行',
  cancelLabel = 'キャンセル',
  variant = 'primary',
  promptLabel,
  promptPlaceholder,
  promptInitial,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [value, setValue] = useState(promptInitial ?? '');
  const [busy, setBusy] = useState(false);

  // open のたびに入力値を初期化
  useEffect(() => {
    if (open) {
      setValue(promptInitial ?? '');
      setBusy(false);
    }
  }, [open, promptInitial]);

  // Esc キーで閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const canSubmit = !busy && (!promptLabel || value.trim().length > 0);

  async function handleConfirm() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onConfirm(value.trim());
    } finally {
      setBusy(false);
    }
  }

  const confirmClass = {
    primary: 'bg-brand-primary text-white border-brand-primary hover:bg-blue-600',
    danger: 'bg-status-error text-white border-status-error hover:bg-red-600',
    warn: 'bg-status-warn text-black border-status-warn hover:bg-amber-400',
    success: 'bg-status-ok text-white border-status-ok hover:bg-emerald-600',
  }[variant];

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="bg-surface-panel border border-surface-border rounded-xl shadow-modal max-w-md w-full p-5">
        <h2 className="text-base font-bold text-ink-strong mb-2">{title}</h2>
        {body && <div className="text-2xs text-ink mb-3">{body}</div>}
        {promptLabel && (
          <div className="mb-3">
            <label className="text-2xs text-ink-subtle block mb-1">{promptLabel}</label>
            <textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={promptPlaceholder}
              rows={3}
              disabled={busy}
              className="w-full bg-surface-base border border-surface-border rounded px-2 py-1.5 text-sm text-ink resize-none focus:outline-none focus:border-brand-primary disabled:opacity-50"
            />
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded border border-surface-border bg-surface-base text-ink hover:bg-surface-raised disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className={`px-3 py-1.5 text-xs font-bold rounded border ${confirmClass} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
