'use client';

/**
 * 📊 レポート タブ本体（A-Rep1）
 *
 * モック準拠（管理用PCモック_v0.22.html L3510-3557）。
 *
 * 構成:
 *  1. 期間ツールバー（粒度 + 範囲 + 比較 + CSV/PDF/印刷）
 *  2. サブタブ（11 種、URL 同期 ?rsub=）
 *  3. アクティブ pane を描画
 */

import { useRouter, useSearchParams } from 'next/navigation';
import {
  DEFAULT_REPORT_SUBTAB,
  REPORT_SUBTABS,
  isReportSubTabId,
  type ReportSubTabId,
} from './report-tabs-config';
import {
  ReportPeriodProvider,
} from './report-period-context';
import { ReportPeriodToolbar } from './report-period-toolbar';
import { SummaryPane } from './summary-pane';
import { GroupPane } from './group-pane';
import { TablePane } from './table-pane';
import { InsptimePane } from './insptime-pane';
import { StaffPane } from './staff-pane';
import { ForceReportPane } from './force-pane';
import { CarrierReportPane } from './carrier-pane';
import { ProductPane } from './product-pane';
import { HourlyPane } from './hourly-pane';
import { ErrorPane } from './error-pane';
import { AuxPane } from './aux-pane';

export function ReportPane() {
  return (
    <ReportPeriodProvider>
      <ReportPaneInner />
    </ReportPeriodProvider>
  );
}

function ReportPaneInner() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('rsub');
  const active: ReportSubTabId = isReportSubTabId(raw) ? raw : DEFAULT_REPORT_SUBTAB;

  function go(id: ReportSubTabId) {
    const sp = new URLSearchParams(params.toString());
    sp.set('rsub', id);
    router.replace(`/dashboard?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col h-full p-2 gap-2 overflow-hidden">
      <ReportPeriodToolbar />

      {/* サブタブ */}
      <div className="flex flex-wrap gap-1">
        {REPORT_SUBTABS.map((t) => (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            className={`px-2 py-1 rounded border text-[10px] transition-colors whitespace-nowrap ${
              t.id === active
                ? 'bg-orange-900 text-orange-100 border-orange-500 font-bold'
                : 'bg-surface-base border-surface-border text-ink-subtle hover:text-ink hover:border-accent-amber/60'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">{renderPane(active)}</div>
    </div>
  );
}

function renderPane(active: ReportSubTabId) {
  switch (active) {
    case 'summary':
      return <SummaryPane />;
    case 'group':
      return <GroupPane />;
    case 'table':
      return <TablePane />;
    case 'insptime':
      return <InsptimePane />;
    case 'staff':
      return <StaffPane />;
    case 'force':
      return <ForceReportPane />;
    case 'carrier':
      return <CarrierReportPane />;
    case 'product':
      return <ProductPane />;
    case 'hourly':
      return <HourlyPane />;
    case 'error':
      return <ErrorPane />;
    case 'aux':
      return <AuxPane />;
  }
}
