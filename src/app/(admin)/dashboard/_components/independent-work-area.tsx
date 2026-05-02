'use client';

/**
 * 独立作業エリア（ライン / 仕分 / SAS）
 * 現状: API データが揃っていないため最小限の見た目を確保。
 * Phase 7-5 でデータバインディング強化予定。
 */

import { cn } from '@/lib/cn';

interface Card {
  category: 'line' | 'sort' | 'sas';
  label: string;
  badge: string;
  /** 表示する数値文字列。null なら "件数カウントなし" を表示。 */
  value: string | null;
  unit: string;
  meta: string;
  staff: number;
}

const SAMPLE_CARDS: Card[] = [
  {
    category: 'line',
    label: 'ライン',
    badge: 'LINE',
    value: null,
    unit: '',
    meta: 'ピッキング票の流し込み作業 / 件数は集計しません',
    staff: 0,
  },
  {
    category: 'sort',
    label: '仕分',
    badge: 'SORT',
    value: '0',
    unit: '/ —',
    meta: '出荷仕分（運送会社別）',
    staff: 0,
  },
  {
    category: 'sas',
    label: 'SAS / 前裁き',
    badge: 'SAS',
    value: '0',
    unit: '名',
    meta: 'グループ内配置（前裁き要員）',
    staff: 0,
  },
];

const CATEGORY_COLOR: Record<Card['category'], { border: string; chip: string }> = {
  line: { border: 'border-l-frozen', chip: 'bg-cyan-900/40 text-cyan-300' },
  sort: { border: 'border-l-status-warn', chip: 'bg-orange-900/40 text-orange-300' },
  sas: { border: 'border-l-purple-500', chip: 'bg-purple-900/40 text-purple-300' },
};

export function IndependentWorkArea() {
  return (
    <div className="grid grid-cols-3 gap-2 h-full p-2.5">
      {SAMPLE_CARDS.map((c) => {
        const color = CATEGORY_COLOR[c.category];
        return (
          <div
            key={c.category}
            className={cn(
              'bg-surface-base border border-surface-border border-l-4 rounded p-2 flex flex-col gap-0.5',
              color.border,
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="text-xs font-bold text-ink-strong truncate">{c.label}</span>
                <span
                  className={cn(
                    'text-3xs px-1 py-px rounded font-bold tracking-wider',
                    color.chip,
                  )}
                >
                  {c.badge}
                </span>
              </div>
              {c.value === null ? (
                <span className="text-2xs text-ink-muted">件数カウントなし</span>
              ) : (
                <span className="text-base font-bold text-accent-amber tabular-nums">
                  {c.value}
                  {c.unit && (
                    <span className="text-2xs text-ink-muted ml-0.5">{c.unit}</span>
                  )}
                </span>
              )}
            </div>
            <div className="text-3xs text-ink-subtle truncate">{c.meta}</div>
            <div className="text-3xs text-ink-muted mt-auto">配置 {c.staff}名</div>
          </div>
        );
      })}
    </div>
  );
}
