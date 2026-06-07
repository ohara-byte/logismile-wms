'use client';

/**
 * ⏱ 検品時間分析 サブタブ（A-Rep2）
 *
 * 所要時間の統計（平均/中央値/p90/p99/max）+ 30 秒バケット分布 +
 * 商品点数別の平均所要時間。
 */

import { useEffect, useState } from 'react';
import { useReportPeriod } from './report-period-context';

interface InspTimeData {
  count: number;
  avg: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  buckets: { label: string; sec: number; count: number }[];
  byItemCount: { label: string; count: number; avgSec: number }[];
}

export function InsptimePane() {
  const period = useReportPeriod();
  const [data, setData] = useState<InspTimeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/insptime?from=${period.from}&to=${period.to}`)
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
  if (data.count === 0) {
    return (
      <div className="p-4 text-2xs text-ink-muted text-center">
        期間内に完了したセッションがありません
      </div>
    );
  }

  // I-1: API が想定外の形を返してもクラッシュしないようガード
  const buckets = data.buckets ?? [];
  const byItemCount = data.byItemCount ?? [];
  const maxBucket = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div className="p-1 space-y-3">
      {/* 統計 KPI */}
      <div className="grid grid-cols-6 gap-1.5">
        <Kpi label="完了件数" value={data.count.toLocaleString()} unit="件" tone="blue" />
        <Kpi label="平均" value={fmt(data.avg)} unit="秒" tone="green" />
        <Kpi label="中央値" value={fmt(data.p50)} unit="秒" tone="cyan" />
        <Kpi label="P90" value={fmt(data.p90)} unit="秒" tone="orange" />
        <Kpi label="P99" value={fmt(data.p99)} unit="秒" tone="red" />
        <Kpi label="最大" value={fmt(data.max)} unit="秒" tone="red" />
      </div>

      {/* 分布ヒストグラム */}
      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          📊 所要時間分布（30 秒バケット）
        </h5>
        <div className="bg-surface-base border border-surface-border rounded p-2">
          <div
            className="grid gap-0.5 items-end"
            style={{
              gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
              height: 100,
            }}
          >
            {buckets.map((b) => (
              <div key={b.sec} className="flex flex-col items-center gap-0.5 min-w-0">
                <div
                  className="w-full bg-gradient-to-t from-cyan-700 to-cyan-300 rounded-t"
                  style={{ height: `${(b.count / maxBucket) * 100}%` }}
                  title={`${b.label}: ${b.count}件`}
                />
                <div className="text-[7px] text-ink-muted font-mono leading-tight">
                  {b.sec}
                </div>
              </div>
            ))}
          </div>
          <div className="text-3xs text-ink-muted mt-1">横軸: 秒、縦軸: 件数</div>
        </div>
      </div>

      {/* 商品点数別 */}
      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          📦 商品点数別 平均所要時間
        </h5>
        <div className="border border-surface-border rounded overflow-hidden">
          <table className="w-full text-2xs">
            <thead className="bg-surface-base border-b border-surface-border">
              <tr>
                <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">点数</th>
                <th className="px-2 py-1 text-right text-3xs uppercase text-ink-subtle">件数</th>
                <th className="px-2 py-1 text-right text-3xs uppercase text-ink-subtle">平均所要時間</th>
              </tr>
            </thead>
            <tbody>
              {byItemCount.map((g) => (
                <tr key={g.label} className="border-t border-surface-border">
                  <td className="px-2 py-1">{g.label}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{g.count.toLocaleString()}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-bold">{fmt(g.avgSec)} 秒</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function fmt(sec: number): string {
  if (sec < 60) return `${sec}`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Kpi({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone: 'blue' | 'green' | 'cyan' | 'orange' | 'red';
}) {
  const map = {
    blue: 'border-blue-500/40 bg-blue-950/30',
    green: 'border-emerald-500/40 bg-emerald-950/30',
    cyan: 'border-cyan-500/40 bg-cyan-950/30',
    orange: 'border-orange-500/40 bg-orange-950/30',
    red: 'border-red-500/40 bg-red-950/30',
  };
  return (
    <div className={`rounded border ${map[tone]} px-2 py-1.5`}>
      <div className="text-3xs text-ink-muted">{label}</div>
      <div className="text-base font-bold tabular-nums leading-none mt-0.5">
        {value}
        <span className="text-[10px] text-ink-muted ml-0.5 font-normal">{unit}</span>
      </div>
    </div>
  );
}
