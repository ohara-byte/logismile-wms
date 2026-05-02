'use client';

/**
 * 管理PC ダッシュボード メインクライアント（Phase 7-2）
 *
 * 4 段グリッド:
 *  - 108px: KPI ストリップ
 *  - 1fr  : テーブルグループ別進捗
 *  - 96px : 独立作業エリア
 *  - 208px: 1時間別実績 + 30分要員配置
 *
 * ポーリング 5 秒間隔で全データを更新。
 */

import { useEffect, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/ui/panel';
import { KpiStrip } from './kpi-strip';
import { GroupProgressGrid } from './group-progress-grid';
import { IndependentWorkArea } from './independent-work-area';
import { HourlyChart } from './hourly-chart';
import { StaffAllocationGrid } from './staff-allocation-grid';

interface Overall {
  date: string;
  total: number;
  packed: number;
  pending: number;
  inspecting: number;
  held: number;
  forceOkCount: number;
  forceOkPending: number;
  forceOkByReason: Record<string, number>;
  completionRate: number;
  recentRate: number;
  avgDurationSec: number | null;
  planDelta: number;
  etaCompletion: string | null;
  etaDeltaMin: number | null;
  stages: { hour: number; target: number; status: 'done' | 'current' | 'wait' }[];
}

interface Group {
  groupId: string;
  groupName: string;
  tables: string[];
  assignedStaff: number;
  staffNames: string[];
  hourlyCapacity: number;
  done: number;
  plan: number;
  remaining: number;
  progressRate: number;
  status: 'working' | 'done' | 'alert' | 'wait';
  etaTime: string | null;
  etaStatus: 'ok' | 'warn' | 'over' | 'done' | null;
  etaRemainingMin: number | null;
  stdMin: number;
  skillCoef: number;
  delayFlag: boolean;
}

interface HourlyChartPoint {
  hour: number;
  planHourly: number;
  actualHourly: number;
  isCurrent: boolean;
}

interface StaffGrid {
  rows: Array<{
    category: 'group' | 'line' | 'sort' | 'sas';
    label: string;
    slots: number[];
  }>;
  summary: {
    currentTime: string;
    currentCount: number;
    amPeak: { time: string; count: number };
    pmPeak: { time: string; count: number };
    totalManHours: number;
  };
}

interface Alert {
  id: number;
  type: string;
  severity: string;
  title: string;
  body: string | null;
  refCode: string | null;
  resolved: boolean;
  createdAt: string;
}

interface DashboardData {
  overall: Overall;
  groups: Group[];
  hourlyChart: HourlyChartPoint[];
  staffGrid: StaffGrid;
}

export function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function reload() {
    try {
      const [pr, ar] = await Promise.all([
        fetch('/api/dashboard/progress').then((r) => r.json()),
        fetch('/api/alerts?resolved=false').then((r) => r.json()),
      ]);
      if (pr.data) setData(pr.data);
      if (ar.data) setAlerts(ar.data.items);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    reload();
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, []);

  async function resolveAlert(id: number) {
    await fetch(`/api/alerts/${id}/resolve`, { method: 'PUT' });
    reload();
  }

  if (!data) {
    return (
      <div className="p-6 text-ink-muted text-sm flex items-center gap-2">
        <span className="w-2 h-2 bg-accent-amber rounded-full animate-pulse" />
        ダッシュボードを読み込み中…
      </div>
    );
  }

  return (
    <div
      className="grid gap-2 p-2 max-w-[1600px] mx-auto"
      style={{
        gridTemplateRows: '108px 1fr 96px 208px',
        height: 'calc(100vh - 56px)',
      }}
    >
      {error && (
        <div className="absolute top-2 right-2 bg-status-error-bg text-status-error border border-status-error rounded p-2 text-xs">
          {error}
        </div>
      )}

      {/* 行 1: KPI */}
      <KpiStrip overall={data.overall} />

      {/* 行 2: グループ進捗 + アラート */}
      <div className="grid gap-2 min-h-0" style={{ gridTemplateColumns: '1fr 360px' }}>
        <Panel className="overflow-hidden flex flex-col">
          <PanelHeader
            title="📊 テーブルグループ別 進捗"
            meta={`${data.groups.length} グループ`}
            action={
              <span className="text-3xs text-ink-muted tabular-nums">
                最終更新 {lastUpdated ? formatTime(lastUpdated) : '—'}
              </span>
            }
          />
          <div className="flex-1 overflow-auto">
            <GroupProgressGrid groups={data.groups} />
          </div>
        </Panel>

        <Panel className="overflow-hidden flex flex-col">
          <PanelHeader
            title="🚨 未解決アラート"
            meta={`${alerts.length} 件`}
          />
          <PanelBody className="flex-1 overflow-auto p-2 space-y-1.5">
            {alerts.length === 0 ? (
              <div className="text-xs text-ink-muted text-center py-4">
                未解決アラートはありません
              </div>
            ) : (
              alerts.slice(0, 20).map((a) => (
                <AlertItem key={a.id} alert={a} onResolve={resolveAlert} />
              ))
            )}
          </PanelBody>
        </Panel>
      </div>

      {/* 行 3: 独立作業エリア */}
      <Panel className="overflow-hidden">
        <PanelHeader title="⚙ 独立作業エリア" meta="グループ外のフロー作業" />
        <IndependentWorkArea />
      </Panel>

      {/* 行 4: 1 時間別実績 + 30 分要員配置 */}
      <div className="grid gap-2 min-h-0" style={{ gridTemplateColumns: '1fr 480px' }}>
        <Panel className="overflow-hidden flex flex-col">
          <HourlyChart points={data.hourlyChart} />
        </Panel>
        <Panel className="overflow-hidden flex flex-col">
          <StaffAllocationGrid
            rows={data.staffGrid.rows}
            summary={data.staffGrid.summary}
          />
        </Panel>
      </div>
    </div>
  );
}

function AlertItem({
  alert,
  onResolve,
}: {
  alert: Alert;
  onResolve: (id: number) => void;
}) {
  const sevColor =
    alert.severity === 'error'
      ? 'border-l-status-error bg-red-950/40'
      : alert.severity === 'warn'
        ? 'border-l-status-warn bg-amber-950/40'
        : 'border-l-status-info bg-blue-950/40';
  return (
    <div className={`border-l-2 ${sevColor} rounded px-2 py-1.5 text-3xs`}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-ink-strong truncate">{alert.title}</div>
          {alert.body && (
            <div className="text-3xs text-ink-subtle truncate">{alert.body}</div>
          )}
          <div className="text-3xs text-ink-muted mt-0.5 font-mono">
            {alert.refCode ? `${alert.refCode} · ` : ''}
            {new Date(alert.createdAt).toLocaleTimeString('ja-JP')}
          </div>
        </div>
        <button
          onClick={() => onResolve(alert.id)}
          className="text-3xs text-status-info hover:underline shrink-0"
        >
          解決
        </button>
      </div>
    </div>
  );
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
