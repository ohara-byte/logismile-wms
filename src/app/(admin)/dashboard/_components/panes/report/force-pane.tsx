'use client';

/**
 * ⚠ 強制OK分析 サブタブ（A-Rep3）
 */

import { useEffect, useState } from 'react';
import { useReportPeriod } from './report-period-context';
import {
  FORCE_REASON_LABELS,
  reasonBadgeClass,
  type ForceReasonCode,
} from '@/lib/force-ok';

interface ForceData {
  total: number;
  byReason: { code: string; count: number; pendingApproval: number }[];
  byStaff: { staffCode: string; staffName: string; count: number }[];
}

export function ForceReportPane() {
  const period = useReportPeriod();
  const [data, setData] = useState<ForceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/force?from=${period.from}&to=${period.to}`)
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
        ✅ 期間内に強制OK の発生はありません
      </div>
    );
  }

  const maxReasonCount = Math.max(...data.byReason.map((r) => r.count), 1);
  const maxStaffCount = Math.max(...data.byStaff.map((r) => r.count), 1);

  return (
    <div className="p-1 space-y-3">
      <div className="bg-surface-base border border-surface-border rounded p-2 grid grid-cols-3 gap-2 text-2xs">
        <div>
          <div className="text-3xs text-ink-muted">総発生件数</div>
          <div className="text-base font-bold text-status-warn tabular-nums">
            {data.total.toLocaleString()}<span className="text-2xs text-ink-muted ml-1">件</span>
          </div>
        </div>
        <div>
          <div className="text-3xs text-ink-muted">理由コード数</div>
          <div className="text-base font-bold text-ink-strong tabular-nums">{data.byReason.length}</div>
        </div>
        <div>
          <div className="text-3xs text-ink-muted">担当者数</div>
          <div className="text-base font-bold text-ink-strong tabular-nums">{data.byStaff.length}</div>
        </div>
      </div>

      {/* 理由コード別 */}
      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          🏷 理由コード別
        </h5>
        <div className="border border-surface-border rounded overflow-hidden">
          <table className="w-full text-2xs">
            <thead className="bg-surface-base border-b border-surface-border">
              <tr>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">コード</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">理由</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">件数</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">分布</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">未承認</th>
              </tr>
            </thead>
            <tbody>
              {data.byReason.map((r) => (
                <tr key={r.code} className="border-t border-surface-border">
                  <td className="px-1.5 py-1">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${reasonBadgeClass(
                        r.code as ForceReasonCode,
                      )}`}
                    >
                      {r.code}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-ink">
                    {FORCE_REASON_LABELS[r.code as ForceReasonCode] ?? '—'}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums font-bold">{r.count}</td>
                  <td className="px-1.5 py-1 w-[40%]">
                    <div className="h-1.5 bg-surface-panel rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-700 to-red-500"
                        style={{ width: `${(r.count / maxReasonCount) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td
                    className={`px-1.5 py-1 text-right tabular-nums ${
                      r.pendingApproval > 0 ? 'text-status-error' : 'text-ink-muted'
                    }`}
                  >
                    {r.pendingApproval}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 担当者別 Top 30 */}
      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          👥 担当者別 強制OK 発生数（Top 30）
        </h5>
        <div className="border border-surface-border rounded overflow-hidden max-h-[280px] overflow-y-auto">
          <table className="w-full text-2xs">
            <thead className="bg-surface-base sticky top-0 border-b border-surface-border">
              <tr>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">コード</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">氏名</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">件数</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">分布</th>
              </tr>
            </thead>
            <tbody>
              {data.byStaff.map((s) => (
                <tr key={s.staffCode} className="border-t border-surface-border">
                  <td className="px-1.5 py-1 font-mono">{s.staffCode}</td>
                  <td className="px-1.5 py-1 font-bold">{s.staffName}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{s.count}</td>
                  <td className="px-1.5 py-1">
                    <div className="h-1.5 bg-surface-panel rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-700 to-red-500"
                        style={{ width: `${(s.count / maxStaffCount) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
