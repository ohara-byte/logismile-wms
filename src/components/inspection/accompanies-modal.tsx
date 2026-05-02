'use client';

/**
 * 同梱物確認モーダル（Phase 3-8 / Phase 4-6）
 *
 * - 起動時に `/api/orders/[pkNo]/accompanies` から取得
 * - 1 件ずつ Enter キーで「☑ 確認」
 * - 全件確認したら閉じる（onConfirm 呼び出し）
 */

import { useEffect, useState } from 'react';

export interface Accompany {
  id: string;
  type: string;
  name: string;
  packingNote: string | null;
}

interface Props {
  pkNo: string;
  /** 確認後に呼ばれる。 */
  onConfirm: () => void;
  onCancel: () => void;
}

export function AccompaniesModal({ pkNo, onConfirm, onCancel }: Props) {
  const [accompanies, setAccompanies] = useState<Accompany[] | null>(null);
  const [packingNote, setPackingNote] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    fetch(`/api/orders/${encodeURIComponent(pkNo)}/accompanies`)
      .then((r) => r.json())
      .then((j) => {
        setAccompanies(j.data?.accompanies ?? []);
        setPackingNote(j.data?.setComp?.packingNote ?? null);
      })
      .catch(() => setAccompanies([]));
  }, [pkNo]);

  useEffect(() => {
    if (!accompanies) return;
    if (accompanies.length === 0) {
      onConfirm();
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        if (idx < (accompanies?.length ?? 0) - 1) setIdx((i) => i + 1);
        else onConfirm();
      }
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accompanies, idx, onConfirm, onCancel]);

  if (!accompanies) return null;
  if (accompanies.length === 0) return null;

  const cur = accompanies[idx];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold">
            🎁 同梱物確認 {idx + 1} / {accompanies.length}
          </h2>
        </div>
        <div className="bg-pink-50 border border-pink-200 rounded p-3 mb-4">
          <div className="text-xs text-gray-600">{cur.type}</div>
          <div className="text-lg font-semibold mt-1">{cur.name}</div>
          {cur.packingNote && (
            <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{cur.packingNote}</p>
          )}
        </div>
        {packingNote && idx === 0 && (
          <p className="text-xs text-gray-500 bg-gray-50 rounded p-2 mb-4">
            梱包メモ: {packingNote}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-3 border rounded-lg text-gray-700 hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            onClick={() => {
              if (idx < accompanies.length - 1) setIdx((i) => i + 1);
              else onConfirm();
            }}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium"
          >
            ☑ 確認 {idx < accompanies.length - 1 ? '(次へ)' : '(完了)'}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-3">Enter で進めます</p>
      </div>
    </div>
  );
}
