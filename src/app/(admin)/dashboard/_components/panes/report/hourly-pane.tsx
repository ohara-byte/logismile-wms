'use client';

/**
 * ⏰ 時間帯ピーク サブタブ（A-Rep4）
 *
 * 既存 /api/report/heatmap を活用。
 * 曜日 × 時間帯のヒートマップで駆け込み傾向を可視化。
 * 運送会社締切（17:00 / 16:30 / 16:00）に縦線。
 */

import { useEffect, useState } from 'react';
import { useReportPeriod } from './report-period-context';

interface HeatCell {
  weekday: number; // 0=日, 6=土
  hour: number;
  count: number;
}

interface HeatmapData {
  cells: HeatCell[];
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const HOURS = Array.from({ length: 11 }, (_, i) => 8 + i); // 8-18h

export function HourlyPane() {
  const period = useReportPeriod();
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/heatmap?from=${period.from}&to=${period.to}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setData(j.data ?? null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to]);

  if (loading || !data) {
    return <div className="p-3 text-2xs text-ink-muted">読み込み中…</div>;
  }

  // (weekday, hour) → count map
  const cellMap = new Map<string, number>();
  let max = 0;
  for (const c of data.cells) {
    cellMap.set(`${c.weekday}-${c.hour}`, c.count);
    if (c.count > max) max = c.count;
  }
  if (max === 0) max = 1;

  return (
    <div className="p-1 space-y-3">
      <div className="bg-surface-base border border-surface-border rounded p-2 text-2xs leading-snug">
        💡 1 時間あたり処理件数の曜日別ヒートマップ。
        運送会社の集荷時刻（{' '}
        <ColorTag bg="bg-red-900" text="text-red-200">
          17:00
        </ColorTag>
        ,{' '}
        <ColorTag bg="bg-orange-900" text="text-orange-200">
          16:30
        </ColorTag>
        ,{' '}
        <ColorTag bg="bg-amber-900" text="text-amber-200">
          16:00
        </ColorTag>
        ）に縦線を引いています。駆け込み傾向の確認用。
      </div>

      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          🔥 曜日 × 時間帯（件数）
        </h5>
        <div className="border border-surface-border rounded overflow-auto">
          <table className="w-full text-2xs">
            <thead className="bg-surface-base border-b border-surface-border">
              <tr>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle sticky left-0 bg-surface-base">
                  曜日
                </th>
                {HOURS.map((h) => {
                  const isCutoff = h === 16 || h === 17;
                  return (
                    <th
                      key={h}
                      className={`px-1 py-1 text-center text-3xs font-mono ${
                        h === 17
                          ? 'text-red-300'
                          : h === 16
                            ? 'text-orange-300'
                            : 'text-ink-subtle'
                      } ${isCutoff ? 'border-l-2 border-amber-700' : ''}`}
                    >
                      {h}h
                    </th>
                  );
                })}
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">合計</th>
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((label, w) => {
                const rowSum = HOURS.reduce(
                  (s, h) => s + (cellMap.get(`${w}-${h}`) ?? 0),
                  0,
                );
                const isWeekend = w === 0 || w === 6;
                const dayColor = w === 0 ? 'text-status-error' : w === 6 ? 'text-status-info' : 'text-ink';
                return (
                  <tr key={w} className="border-t border-surface-border">
                    <td className={`px-1.5 py-1 sticky left-0 bg-surface-panel font-bold ${dayColor}`}>
                      {label}
                      {isWeekend && (
                        <span className="ml-1 text-3xs text-ink-muted font-normal">
                          (休)
                        </span>
                      )}
                    </td>
                    {HOURS.map((h) => {
                      const v = cellMap.get(`${w}-${h}`) ?? 0;
                      const intensity = v / max;
                      const isCutoff = h === 16 || h === 17;
                      return (
                        <td
                          key={h}
                          className={`px-1 py-1 text-center font-mono tabular-nums text-2xs ${
                            isCutoff ? 'border-l-2 border-amber-700/40' : ''
                          }`}
                          style={{
                            background:
                              v > 0
                                ? `rgba(239, 68, 68, ${0.1 + intensity * 0.7})`
                                : undefined,
                            color: intensity > 0.5 ? '#fff' : undefined,
                          }}
                        >
                          {v || ''}
                        </td>
                      );
                    })}
                    <td className="px-1.5 py-1 text-right font-mono tabular-nums font-bold">
                      {rowSum.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 集荷時刻凡例 */}
      <div className="text-3xs text-ink-muted">
        ※ 縦線は集荷時刻ライン。締切前（16-17h）に駆け込みがあると
        <span className="text-status-error font-bold">赤色</span>濃度が高くなります。
      </div>
    </div>
  );
}

function ColorTag({
  bg,
  text,
  children,
}: {
  bg: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded ${bg} ${text} font-mono font-bold`}>
      {children}
    </span>
  );
}
