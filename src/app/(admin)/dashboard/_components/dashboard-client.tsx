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
import { StaffAssignmentModal } from './modals/staff-assignment-modal';
import { GroupConfigModal } from './modals/group-config-modal';
import { useBadges } from '@/components/admin/badge-context';

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

interface DashboardData {
  overall: Overall;
  groups: Group[];
  hourlyChart: HourlyChartPoint[];
  staffGrid: StaffGrid;
}

export function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // バッジ件数は SSE 経由で BadgeContext から購読（A-03）
  const { counts: badges } = useBadges();

  // Sprint G-1: 集約 / 全展開トグル + 2 つのモーダル制御
  const [expandMode, setExpandMode] = useState<'none' | 'all'>('none');
  const [staffAssignOpen, setStaffAssignOpen] = useState(false);
  const [groupConfigOpen, setGroupConfigOpen] = useState(false);

  async function reload() {
    try {
      const pr = await fetch('/api/dashboard/progress').then((r) => r.json());
      if (pr.data) setData(pr.data);
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

  return (
    <div
      className="grid gap-2 p-2 max-w-[1920px] mx-auto"
      style={{
        // Sprint E-2: 右ペイン +20%（560 → 672px）、左ペインは縮小
        gridTemplateColumns: '1fr 672px',
        // ヘッダ高 56 → 64 に変更（E-1 ロゴ拡大）
        height: 'calc(100vh - 64px)',
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
        // Sprint Y-13: KPI 行を 97→124px に拡張。
        //   予定段階バーのタイトル/数値/凡例が重ならないよう余白確保。
        style={{ gridTemplateRows: '124px 1fr 107px 208px' }}
      >
        {/* 行 1: KPI */}
        <KpiStrip overall={data.overall} />

        {/* 行 2: グループ進捗（全幅）— Sprint G-1: ヘッダーに 4 つのコントロールを配置（モック L2358-2364 準拠） */}
        <Panel className="overflow-hidden flex flex-col min-h-0">
          <PanelHeader
            title="📊 テーブルグループ別 進捗"
            meta={`${data.groups.length}グループ／${data.groups.reduce(
              (s, g) => s + (g.tables.length || 1),
              0,
            )}テーブル`}
            action={
              <div className="flex items-center gap-2">
                {/* 集約 / 全展開 トグル */}
                <div className="inline-flex rounded-md overflow-hidden border border-surface-border-strong text-2xs">
                  <button
                    type="button"
                    onClick={() => setExpandMode('none')}
                    className={`px-2.5 py-1 font-bold transition-colors ${
                      expandMode === 'none'
                        ? 'bg-accent-amber text-slate-900'
                        : 'bg-surface-base text-ink-subtle hover:text-ink'
                    }`}
                  >
                    集約
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandMode('all')}
                    className={`px-2.5 py-1 font-bold transition-colors border-l border-surface-border-strong ${
                      expandMode === 'all'
                        ? 'bg-accent-amber text-slate-900'
                        : 'bg-surface-base text-ink-subtle hover:text-ink'
                    }`}
                  >
                    全展開
                  </button>
                </div>
                <span className="text-3xs text-ink-muted tabular-nums">
                  最終更新 {lastUpdated ? formatTime(lastUpdated) : '—'}
                </span>
                {/* メンバー割当 */}
                <button
                  type="button"
                  onClick={() => setStaffAssignOpen(true)}
                  className="px-3 py-1 rounded-md text-2xs font-bold text-white bg-purple-700 hover:bg-purple-600 border border-purple-500 transition-colors"
                >
                  👥 メンバー割当
                </button>
                {/* グループ設定 */}
                <button
                  type="button"
                  onClick={() => setGroupConfigOpen(true)}
                  className="px-3 py-1 rounded-md text-2xs font-bold text-ink-strong bg-surface-base hover:bg-surface-raised border border-surface-border-strong transition-colors"
                >
                  ⚙ グループ設定
                </button>
              </div>
            }
          />
          <div className="flex-1 overflow-auto">
            <GroupProgressGrid groups={data.groups} expandMode={expandMode} />
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

      {/* Sprint G-3: メンバー割当モーダル */}
      <StaffAssignmentModal
        open={staffAssignOpen}
        onClose={() => setStaffAssignOpen(false)}
        onSaved={() => {
          // 保存後にダッシュボードを即時リロードして終了予定再計算を反映
          reload();
        }}
      />

      {/* Sprint G-4: テーブルグループ設定モーダル */}
      <GroupConfigModal
        open={groupConfigOpen}
        onClose={() => setGroupConfigOpen(false)}
        onSaved={() => {
          reload();
        }}
      />
    </div>
  );
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
