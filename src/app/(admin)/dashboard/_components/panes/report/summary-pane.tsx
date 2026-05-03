'use client';

/**
 * 📊 サマリー（日別） サブタブ（A-Rep1）
 *
 * モック準拠（管理用PCモック_v0.22.html L3562-3700）。
 *
 * - 期間 KPI 8 枚
 * - 日別推移チャート（簡易）
 * - 日別明細テーブル
 *
 * 既存 /api/report/summary を活用。
 */

import { useEffect, useState } from 'react';
import { useReportPeriod } from './report-period-context';

interface Daily {
  date: string;
  shipped: number;
  packed: number;
  packMin: number;
  manHours: number;
  forceOk: number;
  staffCount: number;
  weekday: string;
}

interface SummaryData {
  daily: Daily[];
  total: {
    shipped: number;
    packed: number;
    packMin: number;
    manHours: number;
    forceOk: number;
  };
  avg: {
    perDay: number;
    perOrderMin: number;
  };
  best: { date: string; shipped: number };
  worst: { date: string; shipped: number };
}

export function SummaryPane() {
  const period = useReportPeriod();
  const [data, setData] = useState<SummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/summary?from=${period.from}&to=${period.to}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.data) setData(j.data);
        else setError(j.message ?? 'データ取得に失敗');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to]);

  if (loading || !data) {
    return (
      <div className="p-3 text-2xs text-ink-muted">
        {error ? `⚠ ${error}` : '読み込み中…'}
      </div>
    );
  }

  const totalDays = data.daily.length;
  const totalPackHours = data.total.packMin / 60;
  const totalManHours = data.total.manHours;
  const avgManMinPerOrder =
    data.total.shipped > 0 ? (data.total.manHours * 60) / data.total.shipped : 0;
  const maxOrders = Math.max(...data.daily.map((d) => d.shipped), 1);

  return (
    <div className="space-y-3 p-1">
      <div>
        <h4 className="text-xs font-bold text-ink-strong mb-2">
          📊 期間サマリー{' '}
          <span className="ml-2 text-2xs text-ink-muted font-normal bg-surface-base px-2 py-0.5 rounded-full border border-surface-border">
            {period.from} 〜 {period.to} ({period.daysCount} 日間)
          </span>
        </h4>
        <div className="grid grid-cols-4 gap-1.5">
          <Kpi tone="blue" label="総出荷数" value={data.total.shipped.toLocaleString()} unit="件" />
          <Kpi
            tone="green"
            label="総梱包時間"
            value={totalPackHours.toFixed(1)}
            unit="時間"
          />
          <Kpi
            tone="violet"
            label="総MH"
            value={totalManHours.toFixed(1)}
            unit="人時"
          />
          <Kpi
            tone="cyan"
            label="1件あたりMH"
            value={avgManMinPerOrder.toFixed(2)}
            unit="分/件"
          />
          <Kpi
            tone="cyan"
            label="日平均出荷"
            value={data.avg.perDay.toLocaleString()}
            unit="件/日"
          />
          <Kpi
            tone="red"
            label="最大出荷日"
            value={data.best.shipped.toLocaleString()}
            unit="件"
            sub={data.best.date}
          />
          <Kpi
            tone="red"
            label="最小出荷日"
            value={data.worst.shipped.toLocaleString()}
            unit="件"
            sub={data.worst.date}
          />
          <Kpi
            tone="orange"
            label="強制OK 件数"
            value={data.total.forceOk.toLocaleString()}
            unit="件"
          />
        </div>
      </div>

      {/* チャート（縦棒シンプル） */}
      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          📈 日別推移
        </h5>
        <div className="bg-surface-base border border-surface-border rounded p-2">
          <div
            className="grid gap-1 items-end"
            style={{
              gridTemplateColumns: `repeat(${Math.max(totalDays, 1)}, minmax(0, 1fr))`,
              height: 120,
            }}
          >
            {data.daily.map((d) => (
              <div key={d.date} className="flex flex-col items-center gap-0.5">
                <div
                  className={`w-full rounded-t bg-gradient-to-t from-blue-700 to-blue-400 ${d.weekday === '日' || d.weekday === '土' ? 'opacity-60' : ''}`}
                  style={{ height: `${(d.shipped / maxOrders) * 100}%` }}
                  title={`${d.date} ${d.weekday}: ${d.shipped} 件`}
                />
                <div className="text-[8px] text-ink-muted font-mono leading-tight">
                  {d.date.slice(5)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 日別明細 */}
      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          📅 日別明細 ({totalDays} 日)
        </h5>
        <div className="border border-surface-border rounded overflow-auto max-h-[300px]">
          <table className="w-full text-2xs">
            <thead className="bg-surface-base sticky top-0 border-b border-surface-border">
              <tr>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">日付</th>
                <th className="px-1.5 py-1 text-center text-3xs uppercase text-ink-subtle">曜</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">出荷数</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">梱包時間 (h)</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">MH (人時)</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">分/件</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">出勤者</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">強制OK</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => {
                const isWeekend = d.weekday === '土' || d.weekday === '日';
                const minPerOrder = d.shipped > 0 ? (d.manHours * 60) / d.shipped : 0;
                return (
                  <tr
                    key={d.date}
                    className={`border-t border-surface-border ${isWeekend ? 'bg-surface-base/50' : ''}`}
                  >
                    <td className="px-1.5 py-1 font-mono">{d.date}</td>
                    <td className={`px-1.5 py-1 text-center ${d.weekday === '日' ? 'text-status-error' : d.weekday === '土' ? 'text-status-info' : 'text-ink'}`}>
                      {d.weekday}
                    </td>
                    <td className="px-1.5 py-1 text-right tabular-nums font-bold">{d.shipped.toLocaleString()}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{(d.packMin / 60).toFixed(1)}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{d.manHours.toFixed(1)}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{minPerOrder.toFixed(2)}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{d.staffCount}</td>
                    <td className={`px-1.5 py-1 text-right tabular-nums ${d.forceOk > 0 ? 'text-status-warn' : 'text-ink-muted'}`}>{d.forceOk}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  tone,
  label,
  value,
  unit,
  sub,
}: {
  tone: 'blue' | 'green' | 'orange' | 'violet' | 'cyan' | 'red';
  label: string;
  value: string;
  unit: string;
  sub?: string;
}) {
  const map = {
    blue: 'border-blue-500/40 bg-blue-950/30',
    green: 'border-emerald-500/40 bg-emerald-950/30',
    orange: 'border-orange-500/40 bg-orange-950/30',
    violet: 'border-violet-500/40 bg-violet-950/30',
    cyan: 'border-cyan-500/40 bg-cyan-950/30',
    red: 'border-red-500/40 bg-red-950/30',
  };
  return (
    <div className={`rounded border ${map[tone]} px-2 py-1.5`}>
      <div className="text-3xs text-ink-muted">{label}</div>
      <div className="text-base font-bold tabular-nums leading-none mt-0.5">
        {value}
        <span className="text-[10px] text-ink-muted ml-0.5 font-normal">{unit}</span>
      </div>
      {sub && <div className="text-3xs text-ink-muted mt-0.5">{sub}</div>}
    </div>
  );
}
