'use client';

/**
 * 1 時間別実績 / 計画 棒グラフ
 *  - X 軸: 8:00 - 17:00（10 時間）
 *  - Y 軸: 件数（最大値はデータの max + 余裕幅）
 *  - 実績バー（青）/ 計画バー（灰、半透明）
 *  - 現時間帯はバーをアンバーグラデで強調
 */

import { cn } from '@/lib/cn';

interface Point {
  hour: number;
  planHourly: number;
  actualHourly: number;
  isCurrent: boolean;
}

interface Props {
  points: Point[];
}

export function HourlyChart({ points }: Props) {
  // Y 軸 max は points の max を超える 50 の倍数（最低 100）
  const maxVal = Math.max(50, ...points.map((p) => Math.max(p.planHourly, p.actualHourly)));
  const yMax = Math.ceil(maxVal / 50) * 50;
  const yTicks = [yMax, Math.round(yMax * 0.75), Math.round(yMax * 0.5), Math.round(yMax * 0.25), 0];

  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-2xs font-bold text-accent-amber uppercase tracking-wider">
          📈 1時間実績 / 予定
        </h3>
        <span className="text-3xs text-ink-muted">8:00 - 17:00</span>
      </div>

      {/* チャート本体 */}
      <div className="flex-1 relative pl-7">
        {/* Y軸 */}
        <div className="absolute left-0 top-3 bottom-0 w-6 flex flex-col justify-between">
          {yTicks.map((t) => (
            <div key={t} className="text-3xs text-ink-muted text-right tabular-nums">
              {t}
            </div>
          ))}
        </div>
        {/* バー */}
        <div className="flex items-end gap-1 h-full pt-3 border-b border-surface-border">
          {points.map((p) => {
            const planH = (p.planHourly / yMax) * 100;
            const actH = (p.actualHourly / yMax) * 100;
            return (
              <div key={p.hour} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                <div className="text-3xs text-ink-strong font-bold tabular-nums leading-none">
                  {p.actualHourly || ''}
                </div>
                <div className="flex items-end gap-px w-full" style={{ height: 'calc(100% - 28px)' }}>
                  <div
                    className={cn(
                      'flex-1',
                      p.isCurrent
                        ? 'bg-gradient-to-b from-accent-amber to-amber-600'
                        : 'bg-status-info',
                    )}
                    style={{ height: `${actH}%` }}
                  />
                  <div
                    className="flex-1 bg-slate-500/50"
                    style={{ height: `${planH}%` }}
                  />
                </div>
                <div
                  className={cn(
                    'text-3xs leading-none',
                    p.isCurrent ? 'text-accent-amber font-bold' : 'text-ink-muted',
                  )}
                >
                  {String(p.hour).padStart(2, '0')}
                  {p.isCurrent && '⭐'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 凡例 */}
      <div className="flex justify-end gap-3 text-3xs text-ink-subtle mt-1">
        <div className="flex items-center gap-1">
          <span className="w-3 h-2 bg-status-info inline-block" />
          実績
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-2 bg-slate-500/50 inline-block" />
          計画
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-2 bg-gradient-to-b from-accent-amber to-amber-600 inline-block" />
          現時間帯
        </div>
      </div>
    </div>
  );
}
