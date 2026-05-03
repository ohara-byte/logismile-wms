'use client';

/**
 * 🚚 配送便種別 サブタブ（A-Rep3）
 */

import { useEffect, useState } from 'react';
import { useReportPeriod } from './report-period-context';

interface CarrierRow {
  code: string;
  name: string;
  short: string | null;
  cool: boolean;
  total: number;
  packed: number;
  remaining: number;
  mhHours: number;
  avgSec: number;
  progressRate: number;
}

export function CarrierReportPane() {
  const period = useReportPeriod();
  const [items, setItems] = useState<CarrierRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/carrier?from=${period.from}&to=${period.to}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setItems(j.data?.items ?? []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to]);

  if (loading) return <div className="p-3 text-2xs text-ink-muted">読み込み中…</div>;

  const totalAll = items.reduce((s, i) => s + i.total, 0);
  const max = Math.max(...items.map((i) => i.total), 1);

  return (
    <div className="p-1 space-y-3">
      <div className="bg-surface-base border border-surface-border rounded p-2 grid grid-cols-3 gap-2 text-2xs">
        <div>
          <div className="text-3xs text-ink-muted">運送会社数</div>
          <div className="text-base font-bold text-ink-strong tabular-nums">{items.length}</div>
        </div>
        <div>
          <div className="text-3xs text-ink-muted">期間総出荷</div>
          <div className="text-base font-bold text-status-info tabular-nums">
            {totalAll.toLocaleString()}<span className="text-2xs text-ink-muted ml-1">件</span>
          </div>
        </div>
        <div>
          <div className="text-3xs text-ink-muted">冷凍便比率</div>
          <div className="text-base font-bold text-cyan-300 tabular-nums">
            {totalAll > 0
              ? `${Math.round(
                  (items.filter((i) => i.cool).reduce((s, i) => s + i.total, 0) / totalAll) * 100,
                )}%`
              : '—'}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-4 text-2xs text-ink-muted text-center">
          期間内のデータがありません
        </div>
      ) : (
        <div className="border border-surface-border rounded overflow-hidden">
          <table className="w-full text-2xs">
            <thead className="bg-surface-base border-b border-surface-border">
              <tr>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">コード</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">名称</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">出荷</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">完了</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">残</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">完了率</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">MH (人時)</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">平均秒</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.code} className="border-t border-surface-border">
                  <td className="px-1.5 py-1 font-mono">{row.code}</td>
                  <td className="px-1.5 py-1 font-bold">
                    {row.name}
                    {row.cool && <span className="ml-1 text-cyan-300">❄</span>}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {row.total.toLocaleString()}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-status-ok">
                    {row.packed.toLocaleString()}
                  </td>
                  <td
                    className={`px-1.5 py-1 text-right tabular-nums ${
                      row.remaining > 0 ? 'text-status-warn' : 'text-ink-muted'
                    }`}
                  >
                    {row.remaining}
                  </td>
                  <td className="px-1.5 py-1 w-[18%]">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-surface-panel rounded overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-700 to-emerald-400"
                          style={{ width: `${row.progressRate * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-ink-muted tabular-nums w-8 text-right">
                        {Math.round(row.progressRate * 100)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-violet-300">
                    {row.mhHours.toFixed(1)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-ink-subtle">
                    {row.avgSec}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 累計バー（視覚比較） */}
      {items.length > 0 && (
        <div>
          <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
            📊 件数 比較
          </h5>
          <div className="space-y-1">
            {items.map((row) => (
              <div key={row.code} className="flex items-center gap-2 text-2xs">
                <div className="w-24 truncate text-ink-subtle">{row.short ?? row.name}</div>
                <div className="flex-1 h-3 bg-surface-base rounded overflow-hidden">
                  <div
                    className={`h-full ${row.cool ? 'bg-gradient-to-r from-cyan-700 to-cyan-400' : 'bg-gradient-to-r from-blue-700 to-blue-400'}`}
                    style={{ width: `${(row.total / max) * 100}%` }}
                  />
                </div>
                <div className="w-16 text-right tabular-nums text-ink">
                  {row.total.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
