'use client';

/**
 * のし確認モーダル（検品開始時、qrPrintFlag=true の伝票に表示）
 *
 * Phase 4 仕様：ハンディは Enter キー操作で確認 → 作業開始
 * 用途：のし対応の伝票で「のし台紙の準備」を喚起する確認画面
 */

import { useEffect } from 'react';

interface Props {
  pkNo: string;
  noshiName: string | null;
  qrPrintFlag: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function NoshiConfirmationModal({ pkNo, noshiName, qrPrintFlag, onConfirm, onCancel }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  return (
    <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-surface-panel border border-surface-border rounded-2xl shadow-modal max-w-md w-full p-6 border-t-[6px] border-t-pink-500">
        <h2 className="text-base font-bold text-pink-300 uppercase tracking-wider mb-3">
          🎀 のし確認
        </h2>
        <div className="bg-amber-950/40 border border-amber-700/40 rounded p-3 mb-4 text-sm">
          <div className="font-mono text-accent-amber">{pkNo}</div>
          <div className="mt-2 text-ink">
            のし表書: <strong className="text-ink-strong">{noshiName ?? '(指定なし)'}</strong>
          </div>
          {qrPrintFlag && (
            <div className="mt-1 text-pink-300 text-xs">
              🖨 QR印刷フラグ: ON（完了時に自動印刷）
            </div>
          )}
        </div>
        <p className="text-sm text-ink mb-4">
          のし台紙を確認の上「☑ 確認」を押してください。
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-3 border border-surface-border-strong rounded-lg text-ink hover:bg-surface-raised"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className="px-6 py-3 bg-blue-700 hover:bg-blue-600 text-white rounded-lg font-bold border border-blue-500"
          >
            ☑ 確認
          </button>
        </div>
        <p className="text-2xs text-ink-muted text-center mt-3">
          Enter で確認 / Esc でキャンセル
        </p>
      </div>
    </div>
  );
}
