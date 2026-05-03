'use client';

/**
 * 管理PC ダッシュボード メインクライアント
 *
 * モック準拠 2 ペイン構造（管理用PCモック_v0.22.html L2300-2463）:
 *  - 左ペイン (1fr) : 進捗ダッシュボード本体
 *      行1 108px : KPI ストリップ
 *      行2 1fr   : テーブルグループ別進捗（全幅）
 *      行3 96px  : 独立作業エリア
 *      行4 208px : 1時間別実績 + 30分要員配置
 *  - 右ペイン (560px) : 10タブ ナビゲーション（A-02 でスカフォールド）
 *
 * Sprint A-04 以降で右ペイン各タブの本実装を進める。
 * 旧アラートパネルは右ペインの「🔔 アラート」タブへ集約予定（A-04）。
 *
 * ポーリング 5 秒間隔で進捗データを更新。
 */

import { useEffect, useState } from 'react';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { KpiStrip } from './kpi-strip';
import { GroupProgressGrid } from './group-progress-grid';
import { IndependentWorkArea } from './independent-work-area';
import { HourlyChart } from './hourly-chart';
import { StaffAllocationGrid } from './staff-allocation-grid';
import { DashboardRightPane } from './dashboard-right-pane';
import type { TabId } from './tabs-config';

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

  if (!data) {
    return (
      <div className="p-6 text-ink-muted text-sm flex items-center gap-2">
        <span className="w-2 h-2 bg-accent-amber rounded-full animate-pulse" />
        ダッシュボードを読み込み中…
      </div>
    );
  }

  // 右ペインのバッジ件数（A-02 はアラート件数のみ実値、他はモックダミー）
  const badges: Partial<Record<TabId, number>> = {
    alerts: alerts.length,
    force: data.overall.forceOkPending,
    ann: 0, // A-06 で実値接続
    link: 0, // A-11 で実値接続
    match: 0, // A-12 で実値接続
  };

  return (
    <div
      className="grid gap-2 p-2 max-w-[1920px] mx-auto"
      style={{
        gridTemplateColumns: '1fr 560px',
        height: 'calc(100vh - 56px)',
      }}
    >
      {error && (
        <div className="absolute top-2 right-2 bg-status-error-bg text-status-error border border-status-error rounded p-2 text-xs z-50">
          {error}
        </div>
      )}

      {/* ============ 左ペイン：進捗ダッシュボード ============ */}
      <div
        className="grid gap-2 min-h-0 overflow-hidden"
        style={{ gridTemplateRows: '108px 1fr 96px 208px' }}
      >
        {/* 行 1: KPI */}
        <KpiStrip overall={data.overall} />

        {/* 行 2: グループ進捗（全幅） */}
        <Panel className="overflow-hidden flex flex-col min-h-0">
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

        {/* 行 3: 独立作業エリア */}
        <Panel className="overflow-hidden">
          <PanelHeader title="⚙ 独立作業エリア" meta="グループ外のフロー作業" />
          <IndependentWorkArea />
        </Panel>

        {/* 行 4: 1時間別実績 + 30分要員配置 */}
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

      {/* ============ 右ペイン：10 タブ ナビ ============ */}
      <DashboardRightPane badges={badges} />
    </div>
  );
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
