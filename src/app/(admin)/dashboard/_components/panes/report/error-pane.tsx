'use client';

/**
 * 🔁 検品エラー率 サブタブ（A-Rep4）
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useReportPeriod } from './report-period-context';
import { KpiDrillModal, type DrillCell } from './kpi-drill-modal';

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

type DrillKind = 'over_scan' | 'not_found' | 'already_done';

interface DrillCtx {
  kind: 'staff' | 'kind';
  staffCode?: string;
  staffName?: string;
  errKind?: DrillKind;
  kindLabel?: string;
}

export function ErrorPane() {
  const router = useRouter();
  const period = useReportPeriod();
  const [data, setData] = useState<ErrorData | null>(null);
  const [loading, setLoading] = useState(true);

  // C-2: ドリルダウン
  const [drill, setDrill] = useState<DrillCtx | null>(null);
  const [drillRows, setDrillRows] = useState<DrillCell[][]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillErr, setDrillErr] = useState<string | null>(null);

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
        if (drill.staffCode) params.set('staffCode', drill.staffCode);
        if (drill.errKind) params.set('kind', drill.errKind);
        const r = await fetch(`/api/report/drill/error-events?${params}`);
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
        const items: Array<{
          occurredAt: string;
          pkNo: string;
          destName: string;
          staffName: string;
          kindLabel: string;
          scanValue: string;
          qty: number;
        }> = j.data?.items ?? [];
        setDrillRows(
          items.map((it) => [
            it.occurredAt,
            it.pkNo,
            it.destName,
            it.staffName,
            it.kindLabel,
            it.scanValue,
            it.qty,
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
                const isError = k === 'over_scan' || k === 'not_found' || k === 'already_done';
                const clickable = isError && v > 0;
                return (
                  <tr
                    key={k}
                    onClick={
                      clickable
                        ? () =>
                            setDrill({
                              kind: 'kind',
                              errKind: k as DrillKind,
                              kindLabel: def.label,
                            })
                        : undefined
                    }
                    className={`border-t border-surface-border ${
                      clickable ? 'cursor-pointer hover:bg-blue-950/30' : ''
                    }`}
                    title={clickable ? 'クリックで該当区分のエラー明細' : undefined}
                  >
                    <td className={`px-1.5 py-1 font-bold ${def.color}`}>
                      {def.label}
                      {clickable && <span className="ml-1 text-3xs opacity-70">🔍</span>}
                    </td>
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
                {data.byStaff.map((s) => {
                  const clickable = s.errorCount > 0;
                  return (
                    <tr
                      key={s.staffCode}
                      onClick={
                        clickable
                          ? () =>
                              setDrill({
                                kind: 'staff',
                                staffCode: s.staffCode,
                                staffName: s.staffName,
                              })
                          : undefined
                      }
                      className={`border-t border-surface-border ${
                        clickable ? 'cursor-pointer hover:bg-blue-950/30' : ''
                      }`}
                      title={clickable ? 'クリックで該当担当者のエラー明細' : undefined}
                    >
                      <td className="px-1.5 py-1 font-mono">{s.staffCode}</td>
                      <td className="px-1.5 py-1 font-bold">
                        {s.staffName}
                        {clickable && (
                          <span className="ml-1 text-3xs opacity-70">🔍</span>
                        )}
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* C-2: ドリルダウン モーダル */}
      <KpiDrillModal
        open={drill !== null}
        loading={drillLoading}
        errorMsg={drillErr}
        title={
          drill?.kind === 'staff'
            ? `${drill.staffName} — エラー明細`
            : drill?.kind === 'kind'
              ? `${drill.kindLabel} — 発生明細`
              : ''
        }
        subtitle={`${period.from} 〜 ${period.to} 期間中。最大 200 件・新しい順。`}
        cols={['発生日時', '伝票No', '配送先', '担当者', '区分', 'スキャン値', 'qty']}
        rows={drillRows}
        emptyHint="該当エラーはありません"
        onClose={() => setDrill(null)}
        onRowClick={(row) => {
          const pkNo = String(row[1] ?? '');
          if (pkNo && pkNo !== '—') router.push(`/orders?pkNo=${encodeURIComponent(pkNo)}`);
        }}
      />
    </div>
  );
}
