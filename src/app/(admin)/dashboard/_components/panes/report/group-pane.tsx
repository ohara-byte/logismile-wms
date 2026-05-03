'use client';

/**
 * 🗂 テーブルグループ別 サブタブ（A-Rep2）
 *
 * モック準拠（管理用PCモック_v0.22.html L3700+ rp-pane-group）。
 * 既存 /api/report/group-mh を使ってグループ別の累計件数 + MH を表示。
 */

import { useEffect, useState } from 'react';
import { useReportPeriod } from './report-period-context';

interface GroupItem {
  groupId: string;
  groupName: string;
  totalCount: number;
  totalMhHours: number;
  hourly: { hour: number; count: number; mhHours: number }[];
}

export function GroupPane() {
  const period = useReportPeriod();
  const [items, setItems] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/group-mh?from=${period.from}&to=${period.to}`)
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

  const grandCount = items.reduce((s, g) => s + g.totalCount, 0);
  const grandMh = items.reduce((s, g) => s + g.totalMhHours, 0);
  const maxCount = Math.max(...items.map((g) => g.totalCount), 1);

  return (
    <div className="p-1 space-y-3">
      {/* 集計サマリ */}
      <div className="bg-surface-base border border-surface-border rounded p-2 grid grid-cols-3 gap-2 text-2xs">
        <div>
          <div className="text-3xs text-ink-muted">グループ数</div>
          <div className="text-base font-bold text-ink-strong tabular-nums">{items.length}</div>
        </div>
        <div>
          <div className="text-3xs text-ink-muted">総件数</div>
          <div className="text-base font-bold text-status-info tabular-nums">
            {grandCount.toLocaleString()}<span className="text-2xs text-ink-muted ml-1">件</span>
          </div>
        </div>
        <div>
          <div className="text-3xs text-ink-muted">総MH</div>
          <div className="text-base font-bold text-violet-300 tabular-nums">
            {grandMh.toFixed(1)}<span className="text-2xs text-ink-muted ml-1">人時</span>
          </div>
        </div>
      </div>

      {/* グループ別累計バー */}
      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          📊 グループ別 累計
        </h5>
        <div className="space-y-1.5">
          {items.length === 0 ? (
            <div className="p-3 text-2xs text-ink-muted text-center">期間内のデータがありません</div>
          ) : (
            items.map((g) => {
              const pct = (g.totalCount / maxCount) * 100;
              const avgMin = g.totalCount > 0 ? (g.totalMhHours * 60) / g.totalCount : 0;
              return (
                <div key={g.groupId} className="bg-surface-base border border-surface-border rounded px-2 py-1.5">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-xs font-bold text-ink-strong">
                      <span className="text-accent-amber font-mono mr-1">{g.groupId}</span>
                      {g.groupName}
                    </span>
                    <span className="text-2xs text-ink-muted tabular-nums">
                      <b className="text-ink">{g.totalCount.toLocaleString()}</b> 件 ／{' '}
                      <b className="text-violet-300">{g.totalMhHours.toFixed(1)}</b> 人時 ／ 平均{' '}
                      <b className="text-cyan-300">{avgMin.toFixed(1)}</b> 分/件
                    </span>
                  </div>
                  <div className="h-2 bg-surface-panel rounded overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-700 to-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 時間帯別マトリクス */}
      {items.length > 0 && (
        <div>
          <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
            ⏰ グループ × 時間帯（件数）
          </h5>
          <div className="border border-surface-border rounded overflow-auto">
            <HourlyMatrix items={items} />
          </div>
        </div>
      )}
    </div>
  );
}

function HourlyMatrix({ items }: { items: GroupItem[] }) {
  const HOURS = Array.from({ length: 11 }, (_, i) => 8 + i); // 8:00〜18:00
  const allCounts = items.flatMap((g) => g.hourly.map((h) => h.count));
  const max = Math.max(...allCounts, 1);

  return (
    <table className="w-full text-2xs">
      <thead className="bg-surface-base border-b border-surface-border">
        <tr>
          <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle sticky left-0 bg-surface-base">
            グループ
          </th>
          {HOURS.map((h) => (
            <th key={h} className="px-1 py-1 text-center text-3xs text-ink-subtle font-mono">
              {h}h
            </th>
          ))}
          <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">合計</th>
        </tr>
      </thead>
      <tbody>
        {items.map((g) => {
          const hourMap = new Map(g.hourly.map((h) => [h.hour, h]));
          return (
            <tr key={g.groupId} className="border-t border-surface-border">
              <td className="px-1.5 py-1 sticky left-0 bg-surface-panel">
                <span className="font-mono text-accent-amber mr-1">{g.groupId}</span>
                <span className="text-ink-subtle">{g.groupName}</span>
              </td>
              {HOURS.map((h) => {
                const cell = hourMap.get(h);
                const v = cell?.count ?? 0;
                const intensity = v / max;
                return (
                  <td
                    key={h}
                    className="px-1 py-1 text-center font-mono tabular-nums text-2xs"
                    style={{
                      background: v > 0
                        ? `rgba(59, 130, 246, ${0.15 + intensity * 0.55})`
                        : undefined,
                      color: intensity > 0.6 ? '#fff' : undefined,
                    }}
                  >
                    {v || ''}
                  </td>
                );
              })}
              <td className="px-1.5 py-1 text-right font-mono tabular-nums font-bold">
                {g.totalCount}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
