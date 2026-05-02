'use client';

/**
 * 箱選定の提案表示（Phase 3-9 / 6-5 Phase 6 で容積計算ロジックに更新）
 *
 * `/api/master/boxes/suggest?pkNo=...` の結果を見せる。
 * 検品 UI のサイドバー / 完了入力欄付近に置く想定。
 */

import { useEffect, useState } from 'react';

interface BoxCandidate {
  code: string;
  name: string;
  type: string;
  sizeRank: number;
  frozen: boolean;
  noshi: boolean;
  innerVolumeMm3: number;
}

interface BoxReasoning {
  totalQty: number;
  hasFrozen: boolean;
  hasNoshi: boolean;
  totalProductVolumeMm3: number;
  requiredInnerMm3: number;
  strategy: 'fixed-set' | 'volume' | 'size-rank-fallback';
  setCompMatch?: { id: string; parentCode: string; parentName: string; exact: boolean };
  notes?: string[];
}

interface BoxSelection {
  recommended: BoxCandidate | null;
  candidates: BoxCandidate[];
  reasoning: BoxReasoning;
}

interface Props {
  pkNo: string;
  selectedBoxCode: string | null;
  onSelect: (boxCode: string | null) => void;
  /** density="compact" でハンディ向けの縦スクロール表示に。 */
  density?: 'compact' | 'wide';
}

const STRATEGY_LABEL: Record<BoxReasoning['strategy'], string> = {
  'fixed-set': '親商品の固定箱',
  volume: '容積計算',
  'size-rank-fallback': '個数推定',
};

export function BoxSuggestion({ pkNo, selectedBoxCode, onSelect, density = 'wide' }: Props) {
  const [data, setData] = useState<BoxSelection | null>(null);

  useEffect(() => {
    fetch(`/api/master/boxes/suggest?pkNo=${encodeURIComponent(pkNo)}`)
      .then((r) => r.json())
      .then((j) => {
        setData(j.data ?? null);
        if (j.data?.recommended && !selectedBoxCode) {
          onSelect(j.data.recommended.code);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkNo]);

  if (!data) return <div className="text-xs text-gray-400">箱候補を読み込み中…</div>;

  const compact = density === 'compact';
  const r = data.reasoning;

  return (
    <div className={`${compact ? 'text-xs' : 'text-sm'}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">📦 推奨の箱</h3>
        <div className="text-xs text-gray-500">
          {STRATEGY_LABEL[r.strategy]}
          {r.hasFrozen ? ' / 冷凍' : ''}
          {r.hasNoshi ? ' / のし' : ''}
        </div>
      </div>
      {data.recommended && (
        <div className="border-2 border-blue-300 bg-blue-50 rounded p-2 mb-2">
          <div className="font-medium">{data.recommended.name}</div>
          <div className="text-xs text-gray-600 font-mono">
            {data.recommended.code} / size {data.recommended.sizeRank}
            {data.recommended.frozen && ' / 冷凍可'}
          </div>
          {r.notes && r.notes.length > 0 && (
            <div className="text-xs text-gray-600 mt-1">{r.notes[0]}</div>
          )}
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
            {b.name} ({b.sizeRank}) {b.frozen ? '❄' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
