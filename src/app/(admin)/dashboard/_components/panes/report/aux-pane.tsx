'use client';

/**
 * 🔌 補助マスタ発生 サブタブ（A-Rep4）
 *
 * Thomas 取込時の未マップ件数推移 + 現状の未マップ商品数 + 登録済 aux 数。
 */

import { useEffect, useState } from 'react';
import { useReportPeriod } from './report-period-context';

interface AuxData {
  daily: { date: string; count: number }[];
  totalUnmapEvents: number;
  currentUnmap: number;
  totalAux: number;
  recentImports: {
    importedAt: string;
    fileType: string;
    filename: string;
    unmapCount: number;
  }[];
}

export function AuxPane() {
  const period = useReportPeriod();
  const [data, setData] = useState<AuxData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/aux-events?from=${period.from}&to=${period.to}`)
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

  const max = Math.max(...data.daily.map((d) => d.count), 1);

  return (
    <div className="p-1 space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        <Card label="期間内 発生総数" value={data.totalUnmapEvents.toLocaleString()} unit="件" tone="orange" />
        <Card label="現在の未マップ商品" value={data.currentUnmap.toLocaleString()} unit="商品" tone="red" />
        <Card label="登録済 補助マスタ" value={data.totalAux.toLocaleString()} unit="件" tone="green" />
      </div>

      {/* 日別推移 */}
      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          📈 日別 未マップ発生数
        </h5>
        {data.daily.length === 0 ? (
          <div className="p-4 text-2xs text-ink-muted text-center bg-surface-base border border-surface-border rounded">
            ✅ 期間内に未マップ商品の発生はありません
          </div>
        ) : (
          <div className="bg-surface-base border border-surface-border rounded p-2">
            <div
              className="grid gap-0.5 items-end"
              style={{
                gridTemplateColumns: `repeat(${data.daily.length}, minmax(0, 1fr))`,
                height: 100,
              }}
            >
              {data.daily.map((d) => (
                <div key={d.date} className="flex flex-col items-center gap-0.5 min-w-0">
                  <div
                    className="w-full bg-gradient-to-t from-orange-700 to-orange-300 rounded-t"
                    style={{ height: `${(d.count / max) * 100}%` }}
                    title={`${d.date}: ${d.count}件`}
                  />
                  <div className="text-[8px] text-ink-muted font-mono leading-tight">
                    {d.date.slice(5)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 直近の取込 */}
      {data.recentImports.length > 0 && (
        <div>
          <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
            📜 直近の取込（未マップ含む）
          </h5>
          <div className="border border-surface-border rounded overflow-hidden">
            <table className="w-full text-2xs">
              <thead className="bg-surface-base border-b border-surface-border">
                <tr>
                  <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">日時</th>
                  <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">種別</th>
                  <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">ファイル名</th>
                  <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">未マップ</th>
                </tr>
              </thead>
              <tbody>
                {data.recentImports.map((r, i) => (
                  <tr key={i} className="border-t border-surface-border">
                    <td className="px-1.5 py-1 font-mono">
                      {new Date(r.importedAt).toLocaleString('ja-JP', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-1.5 py-1">{r.fileType}</td>
                    <td className="px-1.5 py-1 font-mono text-ink-subtle truncate max-w-[260px]">
                      {r.filename}
                    </td>
                    <td
                      className={`px-1.5 py-1 text-right tabular-nums ${
                        r.unmapCount > 0 ? 'text-status-warn font-bold' : 'text-ink-muted'
                      }`}
                    >
                      {r.unmapCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone: 'green' | 'orange' | 'red';
}) {
  const map = {
    green: 'border-emerald-500/40 bg-emerald-950/30',
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
