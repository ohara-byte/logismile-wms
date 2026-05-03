'use client';

/**
 * レポート期間ツールバー（A-Rep1）
 *
 * モック準拠（管理用PCモック_v0.22.html L3514-3542）。
 *
 * 1段目: 期間粒度（日/週/月/任意）+ CSV/PDF/印刷
 * 2段目: 範囲（from-to）+ 比較（前期間/前年同期/比較なし）
 */

import { useReportPeriod, type Granularity, type Comparison } from './report-period-context';

export function ReportPeriodToolbar() {
  const period = useReportPeriod();

  return (
    <div className="bg-surface-base border border-surface-border rounded p-2 space-y-1.5">
      {/* 1段目 */}
      <div className="flex flex-wrap items-center gap-1.5 text-2xs">
        <span className="text-ink-subtle">期間粒度:</span>
        <Seg
          active={period.granularity}
          options={[
            { value: 'day', label: '日次' },
            { value: 'week', label: '週次' },
            { value: 'month', label: '月次' },
            { value: 'custom', label: '任意' },
          ]}
          onChange={(v) => period.setGranularity(v as Granularity)}
        />
        <div className="flex-1" />
        <button
          onClick={() => alert('CSV 出力は将来実装予定')}
          className="px-2 py-0.5 rounded border border-surface-border bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900"
        >
          ⬇ CSV
        </button>
        <button
          onClick={() => alert('PDF 出力は将来実装予定')}
          className="px-2 py-0.5 rounded border border-surface-border bg-red-950/30 text-red-200 hover:bg-red-900"
        >
          📄 PDF
        </button>
        <button
          onClick={() => window.print()}
          className="px-2 py-0.5 rounded border border-surface-border bg-surface-panel text-ink-subtle hover:text-ink"
        >
          🖨 印刷
        </button>
      </div>

      {/* 2段目 */}
      <div className="flex flex-wrap items-center gap-1.5 text-2xs">
        <span className="text-ink-subtle">範囲:</span>
        <input
          type="date"
          value={period.from}
          onChange={(e) => period.setFrom(e.target.value)}
          className="bg-surface-panel border border-surface-border rounded px-1.5 py-0.5 text-2xs text-ink"
        />
        <span className="text-ink-subtle">〜</span>
        <input
          type="date"
          value={period.to}
          onChange={(e) => period.setTo(e.target.value)}
          className="bg-surface-panel border border-surface-border rounded px-1.5 py-0.5 text-2xs text-ink"
        />
        <span className="text-3xs text-ink-muted ml-1">
          ({period.daysCount} 日間)
        </span>
        <span className="text-ink-subtle ml-3">比較:</span>
        <select
          value={period.comparison}
          onChange={(e) => period.setComparison(e.target.value as Comparison)}
          className="bg-surface-panel border border-surface-border rounded px-1.5 py-0.5 text-2xs text-ink"
        >
          <option value="prev_period">前期間</option>
          <option value="prev_year">前年同期</option>
          <option value="none">比較なし</option>
        </select>
      </div>
    </div>
  );
}

function Seg<T extends string>({
  active,
  options,
  onChange,
}: {
  active: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex border border-surface-border rounded overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2 py-0.5 text-2xs ${
            active === o.value
              ? 'bg-brand-primary text-white font-bold'
              : 'bg-surface-panel text-ink-subtle hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
