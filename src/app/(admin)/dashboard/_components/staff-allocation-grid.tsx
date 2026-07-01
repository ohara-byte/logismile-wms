'use client';

/**
 * 30分要員配置グリッド
 *  - 縦軸: グループ + ライン/仕分/SAS
 *  - 横軸: 9:00 - 18:00 30 分刻み（18 スロット）
 *  - セルは 0-5 段階の密度色（x0..x5）
 *  - 現時刻列を黄色アウトラインで強調
 */

import { cn } from '@/lib/cn';

interface Row {
  category: 'group' | 'line' | 'sort' | 'sas';
  label: string;
  slots: number[];
}

interface Props {
  rows: Row[];
  summary: {
    currentTime: string;
    currentCount: number;
    amPeak: { time: string; count: number };
    pmPeak: { time: string; count: number };
    totalManHours: number;
  };
}

const SLOT_COUNT = 18;
const WORK_START_HOUR = 8; // 8時始業（2026-07-01変更）。18スロット = 8:00〜17:00
const LUNCH_SLOTS = [8, 9]; // 12:00, 12:30（始業8時基準：8+4=12:00）

function slotLabel(idx: number): string {
  const h = WORK_START_HOUR + Math.floor(idx / 2);
  const m = (idx % 2) * 30;
  return m === 0 ? `${h}:00` : `:${m}`;
}

const CATEGORY_COLORS: Record<Row['category'], string> = {
  group: 'text-accent-amber',
  line: 'text-frozen-light',
  sort: 'text-orange-300',
  sas: 'text-purple-300',
};

export function StaffAllocationGrid({ rows, summary }: Props) {
  // 現時刻 idx
  const now = new Date();
  const currentIdx =
    (now.getHours() - WORK_START_HOUR) * 2 + (now.getMinutes() >= 30 ? 1 : 0);

  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-2xs font-bold text-accent-amber uppercase tracking-wider">
          👥 30分要員配置
        </h3>
        <span className="text-3xs text-ink-muted">8:00 - 17:00</span>
      </div>

      <div
        className="flex-1 overflow-x-auto overflow-y-hidden bg-slate-950 rounded p-0.5"
        style={{ minHeight: 0 }}
      >
        <div
          className="grid gap-px text-3xs"
          style={{
            gridTemplateColumns: `60px repeat(${SLOT_COUNT}, 32px)`,
            minWidth: '640px',
          }}
        >
          {/* ヘッダ行 */}
          <div className="bg-surface-base px-1 py-0.5 text-ink-muted text-[10px]" />
          {Array.from({ length: SLOT_COUNT }).map((_, i) => {
            const isLunch = LUNCH_SLOTS.includes(i);
            const isNow = i === currentIdx;
            return (
              <div
                key={i}
                className={cn(
                  'px-0.5 py-0.5 text-center border-b border-surface-border',
                  isNow
                    ? 'bg-amber-950 text-accent-amber font-bold'
                    : isLunch
                      ? 'bg-stone-900 text-stone-500'
                      : 'bg-surface-base text-ink-muted',
                )}
              >
                {slotLabel(i)}
              </div>
            );
          })}

          {/* データ行（Sprint E-4: カテゴリ境目に薄いセパレータ — テキスト見出しなし） */}
          {rows.map((r, i) => {
            const prev = i > 0 ? rows[i - 1] : null;
            const isCategoryStart = !prev || prev.category !== r.category;
            return (
              <Row
                key={`${r.category}-${r.label}`}
                row={r}
                currentIdx={currentIdx}
                separator={isCategoryStart && i > 0}
              />
            );
          })}
        </div>
      </div>

      {/* サマリ */}
      <div className="text-3xs text-ink-subtle mt-1.5 pt-1.5 border-t border-surface-border tabular-nums">
        📍 現時刻 {summary.currentTime} 配置 {summary.currentCount}名 / 午前ピーク{' '}
        {summary.amPeak.time} {summary.amPeak.count}名 / 午後ピーク {summary.pmPeak.time}{' '}
        {summary.pmPeak.count}名 / 総人時 {summary.totalManHours.toFixed(1)}h
      </div>
    </div>
  );
}

function Row({
  row,
  currentIdx,
  separator,
}: {
  row: Row;
  currentIdx: number;
  separator?: boolean;
}) {
  // セパレータ: カテゴリ境目で上線のみ（テキスト見出しなし）
  const sepCls = separator ? 'border-t border-surface-border-strong/60' : '';
  return (
    <>
      <div
        className={cn(
          'px-1 py-0.5 font-bold bg-surface-base sticky left-0 truncate',
          CATEGORY_COLORS[row.category],
          sepCls,
        )}
        style={{ fontSize: '10px' }}
      >
        {row.label}
      </div>
      {row.slots.map((n, i) => {
        const isLunch = LUNCH_SLOTS.includes(i);
        const isNow = i === currentIdx;
        const cls = cellClass(n, isLunch);
        return (
          <div
            key={i}
            className={cn(
              'text-center font-bold tabular-nums',
              cls,
              sepCls,
              isNow && 'outline outline-1 outline-accent-amber',
            )}
            style={{ fontSize: '10px' }}
          >
            {isLunch ? 'L' : n > 0 ? n : ''}
          </div>
        );
      })}
    </>
  );
}

function cellClass(n: number, isLunch: boolean): string {
  if (isLunch) return 'bg-stone-900/60 text-stone-500 italic';
  if (n === 0) return 'bg-transparent text-ink-muted';
  if (n === 1) return 'bg-blue-900 text-blue-200';
  if (n === 2) return 'bg-blue-800 text-blue-100';
  if (n === 3) return 'bg-blue-600 text-white';
  if (n === 4) return 'bg-amber-500 text-white';
  return 'bg-red-600 text-white';
}
