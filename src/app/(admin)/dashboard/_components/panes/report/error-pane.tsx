'use client';

/**
 * 🔁 検品エラー率 サブタブ（A-Rep4）
 */

import { useEffect, useState } from 'react';
import { useReportPeriod } from './report-period-context';

interface ErrorData {
  total: number;
  counts: {
    matched: number;
    over_scan: number;
    not_found: number;
    already_done: number;
    other: number;
  };
  errorCount: number;
  errorRate: number;
  byStaff: {
    staffCode: string;
    staffName: string;
    errorCount: number;
    totalCount: number;
    errorRate: number;
  }[];
}

const RESULT_LABELS: Record<keyof ErrorData['counts'], { label: string; color: string }> = {
  matched: { label: '✓ MATCHED', color: 'text-status-ok' },
  over_scan: { label: '⚠ OVER SCAN', color: 'text-status-warn' },
  not_found: { label: '✗ NOT FOUND', color: 'text-status-error' },
  already_done: { label: 'ℹ ALREADY DONE', color: 'text-status-info' },
  other: { label: 'その他', color: 'text-ink-muted' },
};

export function ErrorPane() {
  const period = useReportPeriod();
  const [data, setData] = useState<ErrorData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/error?from=${period.from}&to=${period.to}`)
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

  if (data.total === 0) {
    return (
      <div className="p-4 text-2xs text-ink-muted text-center">
        期間内のスキャンログがありません
      </div>
    );
  }

  return (
    <div className="p-1 space-y-3">
      {/* KPI */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-surface-base border border-surface-border rounded p-2">
          <div className="text-3xs text-ink-muted">総スキャン数</div>
          <div className="text-base font-bold text-ink-strong tabular-nums">
            {data.total.toLocaleString()}
          </div>
        </div>
        <div className="bg-red-950/30 border border-status-error/40 rounded p-2">
          <div className="text-3xs text-ink-muted">エラー件数</div>
          <div className="text-base font-bold text-status-error tabular-nums">
            {data.errorCount.toLocaleString()}
          </div>
        </div>
        <div className="bg-amber-950/30 border border-status-warn/40 rounded p-2">
          <div className="text-3xs text-ink-muted">エラー率</div>
          <div className="text-base font-bold text-status-warn tabular-nums">
            {(data.errorRate * 100).toFixed(2)}%
          </div>
        </div>
      </div>

      {/* 区分別 */}
      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          📊 結果区分別
        </h5>
        <div className="border border-surface-border rounded overflow-hidden">
          <table className="w-full text-2xs">
            <thead className="bg-surface-base border-b border-surface-border">
              <tr>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">区分</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">件数</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">比率</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">分布</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(RESULT_LABELS) as Array<keyof ErrorData['counts']>).map((k) => {
                const v = data.counts[k];
                const def = RESULT_LABELS[k];
                const pct = data.total > 0 ? v / data.total : 0;
                return (
                  <tr key={k} className="border-t border-surface-border">
                    <td className={`px-1.5 py-1 font-bold ${def.color}`}>{def.label}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">
                      {v.toLocaleString()}
                    </td>
                    <td className="px-1.5 py-1 text-right tabular-nums">
                      {(pct * 100).toFixed(2)}%
                    </td>
                    <td className="px-1.5 py-1 w-[40%]">
                      <div className="h-1.5 bg-surface-panel rounded overflow-hidden">
                        <div
                          className={`h-full ${
                            k === 'matched'
                              ? 'bg-status-ok'
                              : k === 'over_scan'
                                ? 'bg-status-warn'
                                : k === 'not_found'
                                  ? 'bg-status-error'
                                  : k === 'already_done'
                                    ? 'bg-status-info'
                                    : 'bg-slate-500'
                          }`}
                          style={{ width: `${pct * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 担当者別エラー率 */}
      {data.byStaff.length > 0 && (
        <div>
          <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
            👥 担当者別エラー率（10 件以上スキャンのみ・上位 10 名）
          </h5>
          <div className="border border-surface-border rounded overflow-hidden">
            <table className="w-full text-2xs">
              <thead className="bg-surface-base border-b border-surface-border">
                <tr>
                  <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">コード</th>
                  <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">氏名</th>
                  <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">スキャン総数</th>
                  <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">エラー</th>
                  <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">エラー率</th>
                </tr>
              </thead>
              <tbody>
                {data.byStaff.map((s) => (
                  <tr key={s.staffCode} className="border-t border-surface-border">
                    <td className="px-1.5 py-1 font-mono">{s.staffCode}</td>
                    <td className="px-1.5 py-1 font-bold">{s.staffName}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">
                      {s.totalCount.toLocaleString()}
                    </td>
                    <td className="px-1.5 py-1 text-right tabular-nums text-status-error">
                      {s.errorCount.toLocaleString()}
                    </td>
                    <td
                      className={`px-1.5 py-1 text-right tabular-nums font-bold ${
                        s.errorRate > 0.05 ? 'text-status-error' : 'text-status-warn'
                      }`}
                    >
                      {(s.errorRate * 100).toFixed(2)}%
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
