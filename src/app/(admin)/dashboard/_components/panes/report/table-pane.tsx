'use client';

/**
 * 🏷 テーブル別 サブタブ（A-Rep2）
 *
 * テーブル単位（device.location）の累計件数 + MH。
 */

import { useEffect, useState } from 'react';
import { useReportPeriod } from './report-period-context';

interface TableItem {
  tableLabel: string;
  deviceCode: string;
  count: number;
  mhHours: number;
  avgSec: number;
}

export function TablePane() {
  const period = useReportPeriod();
  const [items, setItems] = useState<TableItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/table-mh?from=${period.from}&to=${period.to}`)
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

  const total = items.reduce((s, i) => s + i.count, 0);
  const totalMh = items.reduce((s, i) => s + i.mhHours, 0);
  const max = Math.max(...items.map((i) => i.count), 1);

  return (
    <div className="p-1 space-y-3">
      <div className="bg-surface-base border border-surface-border rounded p-2 grid grid-cols-3 gap-2 text-2xs">
        <Stat label="テーブル数" value={`${items.length}`} />
        <Stat label="総件数" value={`${total.toLocaleString()} 件`} />
        <Stat label="総MH" value={`${totalMh.toFixed(1)} 人時`} />
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
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">テーブル</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">端末</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">件数</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">分布</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">MH (人時)</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">平均(秒)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={`${row.tableLabel}-${row.deviceCode}`} className="border-t border-surface-border">
                  <td className="px-1.5 py-1 text-ink-strong">{row.tableLabel}</td>
                  <td className="px-1.5 py-1 font-mono text-ink-subtle">{row.deviceCode}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums font-bold">{row.count.toLocaleString()}</td>
                  <td className="px-1.5 py-1">
                    <div className="h-1.5 bg-surface-panel rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-700 to-emerald-500"
                        style={{ width: `${(row.count / max) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-violet-300">{row.mhHours.toFixed(1)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-ink-subtle">{row.avgSec}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xs text-ink-muted">{label}</div>
      <div className="text-base font-bold text-ink-strong tabular-nums">{value}</div>
    </div>
  );
}
