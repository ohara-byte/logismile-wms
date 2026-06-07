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

  if (!data) return <div className="text-2xs text-ink-muted">箱候補を読み込み中…</div>;

  const compact = density === 'compact';
  const r = data.reasoning;
  // X-1: 推奨箱を先頭にソート（推奨があればそれを最初、それ以外は API の順序を維持）
  const recommendedCode = data.recommended?.code;
  const candidates = recommendedCode
    ? [
        ...data.candidates.filter((b) => b.code === recommendedCode),
        ...data.candidates.filter((b) => b.code !== recommendedCode),
      ]
    : data.candidates;

  // 候補ゼロの警告表示
  if (candidates.length === 0) {
    return (
      <div className="text-2xs text-status-error bg-red-950/40 border border-status-error/40 rounded p-2 leading-tight">
        ⚠ 該当箱なし
        <br />
        手動選定してください
      </div>
    );
  }

  // モック準拠（タブレット検品モック_v0.18.html L845-894 box-cand-mini）:
  // ★ プライマリ候補は緑枠、その他は「候補」タグ。クリックで切替。
  return (
    <div className={compact ? 'text-2xs' : 'text-xs'}>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-2xs font-bold text-accent-amber uppercase tracking-wider">
          📦 推奨の箱
        </h3>
        <div className="text-3xs text-ink-muted">
          {STRATEGY_LABEL[r.strategy]}
          {r.hasFrozen ? ' / 冷凍' : ''}
          {r.hasNoshi ? ' / のし' : ''}
        </div>
      </div>
      {/* V-5: 既定で 3 候補が見える高さに固定し、それ以上は縦スクロールで確認可能 */}
      <div
        className="flex flex-col gap-1.5 overflow-y-auto pr-1"
        style={{
          maxHeight: compact ? 230 : 260, // 約 3 枚分
        }}
      >
        {candidates.map((b) => {
          const isPrimary = b.code === (data.recommended?.code ?? candidates[0]?.code);
          const isSelected = b.code === selectedBoxCode;
          return (
            <BoxCard
              key={b.code}
              box={b}
              isPrimary={isPrimary}
              isSelected={isSelected}
              compact={compact}
              onClick={() => onSelect(b.code)}
            />
          );
        })}
      </div>
      {candidates.length > 3 && (
        <div className="text-3xs text-ink-muted mt-1 leading-tight">
          ⇣ スクロールで残り {candidates.length - 3} 候補を表示
        </div>
      )}
      {r.notes && r.notes.length > 0 && (
        <div className="text-3xs text-ink-muted mt-1.5 leading-tight">
          ※ {r.notes[0]}
        </div>
      )}
    </div>
  );
}

function BoxCard({
  box,
  isPrimary,
  isSelected,
  compact,
  onClick,
}: {
  box: BoxCandidate;
  isPrimary: boolean;
  isSelected: boolean;
  compact: boolean;
  onClick: () => void;
}) {
  const typeLabel: Record<string, { label: string; cls: string }> = {
    fixed: {
      label: '固定',
      cls: 'bg-amber-950/60 text-accent-amber border-amber-700',
    },
    extension: {
      label: '拡張',
      cls: 'bg-purple-950/60 text-purple-200 border-purple-500',
    },
    variable: {
      label: '可変',
      cls: 'bg-blue-950/60 text-blue-200 border-blue-500',
    },
  };
  const t = typeLabel[box.type] ?? typeLabel.variable;

  return (
    <button
      type="button"
      onClick={onClick}
      style={
        isPrimary
          ? {
              borderColor: '#10b981',
              background: '#064e3b',
              boxShadow: isSelected
                ? '0 0 0 2px rgba(16,185,129,0.5)'
                : 'inset 0 0 0 1px rgba(16,185,129,0.3)',
            }
          : undefined
      }
      className={`text-left rounded border-2 px-2 py-1.5 transition-colors ${
        isPrimary
          ? 'hover:brightness-110'
          : isSelected
            ? 'border-status-ok bg-emerald-950/50'
            : 'border-surface-border-strong bg-surface-base hover:border-ink-muted'
      }`}
    >
      {/* row1: ★/候補 タグ + 商品名 */}
      <div className="flex items-center gap-1.5">
        <span
          className={`text-[9px] font-bold leading-none px-1.5 py-0.5 rounded ${
            isPrimary
              ? 'bg-emerald-500 text-white'
              : 'bg-surface-border-strong text-ink-subtle'
          }`}
        >
          {isPrimary ? '★' : '候補'}
        </span>
        <span
          className={`flex-1 truncate font-bold text-ink-strong ${
            compact ? 'text-2xs' : 'text-xs'
          }`}
        >
          {box.name}
        </span>
      </div>
      {/* row2: 種別ピル / sizeRank / 冷凍 / のし / コード */}
      <div className="flex items-center gap-1 mt-1 flex-wrap">
        <span
          className={`text-[9px] font-bold leading-none px-1.5 py-0.5 rounded-full border ${t.cls}`}
        >
          {t.label}
        </span>
        <span className="text-[9px] font-bold leading-none px-1.5 py-0.5 rounded-full border bg-amber-950/30 text-accent-amber border-amber-700">
          R{box.sizeRank}
        </span>
        {box.frozen && (
          <span className="text-[9px] font-bold leading-none px-1.5 py-0.5 rounded-full border bg-cyan-950/40 text-cyan-200 border-cyan-600">
            ❄
          </span>
        )}
        {box.noshi && (
          <span className="text-[9px] font-bold leading-none px-1.5 py-0.5 rounded-full border bg-pink-950/40 text-pink-200 border-pink-600">
            🎁
          </span>
        )}
        <span className="ml-auto text-[9px] font-mono text-blue-300">
          {box.code}
        </span>
      </div>
    </button>
  );
}
