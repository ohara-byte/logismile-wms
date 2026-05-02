'use client';

/**
 * 箱選定の提案表示（Phase 3-9）
 *
 * `/api/master/boxes/suggest?pkNo=...` の結果を見せる。
 * 検品 UI のサイドバー / 完了入力欄付近に置く想定。
 */

import { useEffect, useState } from 'react';

interface Box {
  code: string;
  name: string;
  sizeRank: number;
}

interface Suggestion {
  recommended: Box | null;
  candidates: Array<Box & { type?: string; frozen?: boolean }>;
  reasoning: { totalQty: number; hasFrozen: boolean; targetRank: number; usedFixed: boolean };
}

interface Props {
  pkNo: string;
  selectedBoxCode: string | null;
  onSelect: (boxCode: string | null) => void;
  /** density="compact" でハンディ向けの縦スクロール表示に。 */
  density?: 'compact' | 'wide';
}

export function BoxSuggestion({ pkNo, selectedBoxCode, onSelect, density = 'wide' }: Props) {
  const [data, setData] = useState<Suggestion | null>(null);

  useEffect(() => {
    fetch(`/api/master/boxes/suggest?pkNo=${encodeURIComponent(pkNo)}`)
      .then((r) => r.json())
      .then((j) => {
        setData(j.data ?? null);
        // 既定で recommended を選択
        if (j.data?.recommended && !selectedBoxCode) {
          onSelect(j.data.recommended.code);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkNo]);

  if (!data) return <div className="text-xs text-gray-400">箱候補を読み込み中…</div>;

  const compact = density === 'compact';

  return (
    <div className={`${compact ? 'text-xs' : 'text-sm'}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">📦 推奨の箱</h3>
        <div className="text-xs text-gray-500">
          総数 {data.reasoning.totalQty}
          {data.reasoning.hasFrozen ? ' / 冷凍' : ''}
          {data.reasoning.usedFixed ? ' / 固定箱' : ` / 想定 ${data.reasoning.targetRank}`}
        </div>
      </div>
      {data.recommended && (
        <div className="border-2 border-blue-300 bg-blue-50 rounded p-2 mb-2">
          <div className="font-medium">{data.recommended.name}</div>
          <div className="text-xs text-gray-600 font-mono">
            {data.recommended.code} / size {data.recommended.sizeRank}
          </div>
        </div>
      )}
      <select
        value={selectedBoxCode ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
        className={`w-full border rounded px-2 py-2 ${compact ? '' : 'text-sm'}`}
      >
        <option value="">— 箱を選択 —</option>
        {data.candidates.map((b) => (
          <option key={b.code} value={b.code}>
            {b.name} ({b.sizeRank})
          </option>
        ))}
      </select>
    </div>
  );
}
