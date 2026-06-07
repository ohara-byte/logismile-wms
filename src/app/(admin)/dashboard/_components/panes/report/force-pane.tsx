'use client';

/**
 * ⚠ 強制OK分析 サブタブ（A-Rep3）
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useReportPeriod } from './report-period-context';
import { KpiDrillModal, type DrillCell } from './kpi-drill-modal';
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

interface ForceDrillCtx {
  by: 'reason' | 'staff';
  reasonCode?: string;
  reasonLabel?: string;
  staffCode?: string;
  staffName?: string;
}

export function ForceReportPane() {
  const router = useRouter();
  const period = useReportPeriod();
  const [data, setData] = useState<ForceData | null>(null);
  const [loading, setLoading] = useState(true);

  // C-3: ドリルダウン状態
  const [drill, setDrill] = useState<ForceDrillCtx | null>(null);
  const [drillRows, setDrillRows] = useState<DrillCell[][]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillErr, setDrillErr] = useState<string | null>(null);

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

  // ドリル fetch
  useEffect(() => {
    if (!drill) return;
    let cancelled = false;
    setDrillLoading(true);
    setDrillErr(null);
    setDrillRows([]);
    (async () => {
      try {
        const params = new URLSearchParams({ from: period.from, to: period.to });
        if (drill.reasonCode) params.set('reasonCode', drill.reasonCode);
        if (drill.staffCode) params.set('staffCode', drill.staffCode);
        const r = await fetch(`/api/report/drill/force-events?${params}`);
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
        const items: Array<{
          occurredAt: string;
          pkNo: string;
          destName: string;
          staffName: string;
          reasonCode: string;
          reasonText: string;
          itemCode: string;
        }> = j.data?.items ?? [];
        setDrillRows(
          items.map((it) => [
            it.occurredAt,
            it.pkNo,
            it.destName,
            it.staffName,
            it.reasonCode,
            it.reasonText,
            it.itemCode,
          ]),
        );
      } catch (e) {
        if (!cancelled) setDrillErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setDrillLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drill, period.from, period.to]);

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
                <tr
                  key={r.code}
                  onClick={() =>
                    setDrill({
                      by: 'reason',
                      reasonCode: r.code,
                      reasonLabel:
                        FORCE_REASON_LABELS[r.code as ForceReasonCode] ?? r.code,
                    })
                  }
                  className="border-t border-surface-border cursor-pointer hover:bg-blue-950/30"
                  title="クリックで該当理由コードの発生明細"
                >
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
                    <span className="ml-1 text-3xs text-ink-muted">🔍</span>
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
                <tr
                  key={s.staffCode}
                  onClick={() =>
                    setDrill({
                      by: 'staff',
                      staffCode: s.staffCode,
                      staffName: s.staffName,
                    })
                  }
                  className="border-t border-surface-border cursor-pointer hover:bg-blue-950/30"
                  title="クリックで該当担当者の発生明細"
                >
                  <td className="px-1.5 py-1 font-mono">{s.staffCode}</td>
                  <td className="px-1.5 py-1 font-bold">
                    {s.staffName}
                    <span className="ml-1 text-3xs text-ink-muted">🔍</span>
                  </td>
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

      {/* C-3: ドリルダウン モーダル */}
      <KpiDrillModal
        open={drill !== null}
        loading={drillLoading}
        errorMsg={drillErr}
        title={
          drill?.by === 'reason'
            ? `${drill.reasonCode} ${drill.reasonLabel ?? ''} — 強制OK 発生明細`
            : drill?.by === 'staff'
              ? `${drill.staffName} — 強制OK 発生明細`
              : ''
        }
        subtitle={`${period.from} 〜 ${period.to} 期間中。最大 200 件・新しい順。`}
        cols={['発生日時', '伝票No', '配送先', '担当者', '理由', '理由テキスト', '商品']}
        rows={drillRows}
        emptyHint="該当する強制OK 発生はありません"
        onClose={() => setDrill(null)}
        onRowClick={(row) => {
          const pkNo = String(row[1] ?? '');
          if (pkNo && pkNo !== '—') router.push(`/orders?pkNo=${encodeURIComponent(pkNo)}`);
        }}
      />
    </div>
  );
}
