'use client';

/**
 * 👥 担当者別MH サブタブ（A-Rep3）
 *
 * 既存 /api/report/staff-mh を活用。担当者ごとの件数・MH・平均秒・スキル係数。
 */

import { useEffect, useState } from 'react';
import { useReportPeriod } from './report-period-context';

interface StaffRow {
  staffCode: string;
  staffName: string;
  count: number;
  durationSec: number;
  mhHours: number;
  avgSec: number;
}

export function StaffPane() {
  const period = useReportPeriod();
  const [items, setItems] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/report/staff-mh?from=${period.from}&to=${period.to}`).then((r) => r.json()),
      fetch('/api/master/staff').then((r) => r.json()),
    ])
      .then(([s, m]) => {
        if (cancelled) return;
        setItems(s.data?.items ?? []);
        const map = new Map<string, number>();
        for (const st of m.data?.items ?? []) {
          map.set(st.code, Number(st.skillCoefficient ?? 1));
        }
        setSkills(map);
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
        <Stat label="担当者数" value={`${items.length}`} />
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
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">順位</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">コード</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">氏名</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">件数</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">分布</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">MH (人時)</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">平均(秒)</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">スキル</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, idx) => {
                const skill = skills.get(row.staffCode);
                const skillCls =
                  skill !== undefined && skill < 0.85
                    ? 'text-status-ok font-bold'
                    : skill !== undefined && skill > 1.15
                      ? 'text-status-warn'
                      : 'text-ink';
                return (
                  <tr key={row.staffCode} className="border-t border-surface-border">
                    <td className="px-1.5 py-1 text-ink-muted tabular-nums">{idx + 1}</td>
                    <td className="px-1.5 py-1 font-mono">{row.staffCode}</td>
                    <td className="px-1.5 py-1 font-bold">{row.staffName}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{row.count.toLocaleString()}</td>
                    <td className="px-1.5 py-1">
                      <div className="h-1.5 bg-surface-panel rounded overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-violet-700 to-violet-400"
                          style={{ width: `${(row.count / max) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-1.5 py-1 text-right tabular-nums text-violet-300">{row.mhHours.toFixed(1)}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{row.avgSec}</td>
                    <td className={`px-1.5 py-1 text-right tabular-nums ${skillCls}`}>
                      {skill !== undefined ? skill.toFixed(3) : '—'}
                    </td>
                  </tr>
                );
              })}
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
