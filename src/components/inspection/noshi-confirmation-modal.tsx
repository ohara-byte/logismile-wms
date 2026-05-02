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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <h2 className="text-lg font-bold mb-3">🎀 のし確認</h2>
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-sm">
          <div className="font-mono">{pkNo}</div>
          <div className="mt-2">
            のし表書: <strong>{noshiName ?? '(指定なし)'}</strong>
          </div>
          {qrPrintFlag && (
            <div className="mt-1 text-blue-700">QR印刷フラグ: ON（完了時に自動印刷）</div>
          )}
        </div>
        <p className="text-sm text-gray-700 mb-4">
          のし台紙を確認の上「☑ 確認」を押してください。
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-3 border rounded-lg text-gray-700 hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium"
          >
            ☑ 確認
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-3">
          Enter で確認 / Esc でキャンセル
        </p>
      </div>
    </div>
  );
}
