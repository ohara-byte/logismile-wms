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
    <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-surface-panel border border-surface-border rounded-2xl shadow-modal max-w-md w-full p-6 border-t-[6px] border-t-pink-500">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-base font-bold text-pink-300 uppercase tracking-wider">
            🎁 同梱物確認 <span className="text-ink-subtle ml-1">{idx + 1} / {accompanies.length}</span>
          </h2>
        </div>
        <div className="bg-pink-950/40 border border-pink-700/40 rounded p-3 mb-4">
          <div className="text-2xs text-ink-subtle uppercase">{cur.type}</div>
          <div className="text-lg font-semibold text-ink-strong mt-1">{cur.name}</div>
          {cur.packingNote && (
            <p className="text-sm text-ink mt-2 whitespace-pre-wrap">{cur.packingNote}</p>
          )}
        </div>
        {packingNote && idx === 0 && (
          <p className="text-2xs text-ink-subtle bg-surface-base rounded p-2 mb-4 border border-surface-border">
            📝 梱包メモ: {packingNote}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-3 border border-surface-border-strong rounded-lg text-ink hover:bg-surface-raised"
          >
            キャンセル
          </button>
          <button
            onClick={() => {
              if (idx < accompanies.length - 1) setIdx((i) => i + 1);
              else onConfirm();
            }}
            className="px-6 py-3 bg-blue-700 hover:bg-blue-600 text-white rounded-lg font-bold border border-blue-500"
          >
            ☑ 確認 {idx < accompanies.length - 1 ? '(次へ)' : '(完了)'}
          </button>
        </div>
        <p className="text-2xs text-ink-muted text-center mt-3">Enter で進めます</p>
      </div>
    </div>
  );
}
