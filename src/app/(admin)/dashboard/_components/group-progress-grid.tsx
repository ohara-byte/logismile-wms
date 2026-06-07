'use client';

/**
 * グループ別進捗カードグリッド（4 列）
 *  - 各カードに進捗バー + 終了予定行 + 配置メンバー
 *  - 状態バッジ（working/done/alert/wait）
 *  - 終了予定 4 段階（ok/warn/over/done）
 */

import { cn } from '@/lib/cn';

type GroupStatus = 'working' | 'done' | 'alert' | 'wait';
type EtaStatus = 'ok' | 'warn' | 'over' | 'done';

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
  status: GroupStatus;
  etaTime: string | null;
  etaStatus: EtaStatus | null;
  etaRemainingMin: number | null;
  stdMin: number;
  skillCoef: number;
  delayFlag: boolean;
}

interface Props {
  groups: Group[];
  /** Sprint G-5: 集約=サマリのみ、全展開=テーブル単位の内訳行も表示 */
  expandMode?: 'none' | 'all';
}

export function GroupProgressGrid({ groups, expandMode = 'none' }: Props) {
  if (groups.length === 0) {
    return (
      <div className="p-6 text-center text-ink-muted text-xs">
        グループが登録されていません
      </div>
    );
  }
  // Sprint Y-13: 1024×768 等の小型モニタでも全カードが視認できるよう
  //  カラム数を段階的に増やす（小さい解像度では 1 行に 4-5 列、大型で 5-6 列）
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-1.5 p-2.5">
      {groups.map((g) => (
        <GroupCard key={g.groupId} group={g} expanded={expandMode === 'all'} />
      ))}
    </div>
  );
}

// Sprint Y-13: グループ固有色（既知 ID は固定。未知の場合は ID ハッシュで色付け）
const GROUP_COLORS = [
  '#fb923c', // orange
  '#facc15', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#ef4444', // red
  '#a78bfa', // violet
  '#0e7490', // cyan-deep
  '#b45309', // amber-deep
  '#6d28d9', // purple-deep
  '#ec4899', // pink
  '#10b981', // emerald
  '#06b6d4', // cyan
];
const KNOWN_GROUP_COLORS: Record<string, string> = {
  ABL: '#fb923c',
  AB: '#fb923c',
  CD: '#facc15',
  CML: '#22c55e',
  K: '#3b82f6',
  I: '#ef4444',
  O: '#a78bfa',
  RQ: '#0e7490',
  S: '#b45309',
  SAS: '#6d28d9',
  H: '#ec4899',
  LINE: '#10b981',
  SORT: '#06b6d4',
};

function groupColorFromId(groupId: string): string {
  const upper = groupId.toUpperCase();
  if (KNOWN_GROUP_COLORS[upper]) return KNOWN_GROUP_COLORS[upper];
  // 未知 ID は単純ハッシュで色配列から選ぶ
  let h = 0;
  for (let i = 0; i < upper.length; i++) {
    h = (h * 31 + upper.charCodeAt(i)) & 0xffffffff;
  }
  return GROUP_COLORS[Math.abs(h) % GROUP_COLORS.length];
}

function GroupCard({ group, expanded }: { group: Group; expanded?: boolean }) {
  const isAlert = group.status === 'alert';
  const isDone = group.status === 'done';
  const isWorking = group.status === 'working';

  // Sprint Y-13: 縦バーはステータス優先（遅延/完了/稼働中）+ 待機時はグループ固有色
  //   稼働状態 → 異常を最優先で目立たせ、待機時はグループ識別色で並びを把握しやすくする
  const sideBarColor = isAlert
    ? '#ef4444' // 遅延=赤
    : isDone
      ? '#10b981' // 完了=緑
      : isWorking
        ? '#3b82f6' // 稼働中=青
        : groupColorFromId(group.groupId); // 待機=グループ固有色

  return (
    <div
      className={cn(
        'border rounded p-2 pl-3 cursor-pointer transition-all hover:-translate-y-0.5',
        isAlert
          ? 'border-status-error bg-red-950/40'
          : isDone
            ? 'border-status-ok bg-emerald-950/40'
            : 'border-surface-border bg-surface-base hover:border-accent-amber',
      )}
      style={{
        borderLeftWidth: 5,
        borderLeftColor: sideBarColor,
        borderLeftStyle: 'solid',
      }}
    >
      {/* row1: タイトル + バッジ — グループ名は 14px（識別性優先） */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-baseline gap-1 min-w-0">
          <span className="text-sm font-bold text-ink-strong">{group.groupName}</span>
          {group.tables.length > 0 && (
            <span className="text-3xs text-ink-muted tracking-wide truncate">
              ({group.tables.join('・')})
            </span>
          )}
        </div>
        <StatusBadge status={group.status} />
      </div>

      {/* row2: 数値 */}
      <div className="flex justify-between items-baseline mb-1">
        <div className="text-xs">
          <span className="font-bold tabular-nums text-ink-strong">{group.done}</span>
          <span className="text-ink-muted"> / {group.plan}</span>
        </div>
        <span className="text-2xs text-accent-amber font-bold tabular-nums">
          {group.progressRate}%
        </span>
      </div>

      {/* progress bar */}
      <div className="h-1.5 bg-surface-base border border-surface-border rounded-sm overflow-hidden mb-1.5">
        <div
          className="h-full transition-all"
          style={{
            width: `${Math.min(100, group.progressRate)}%`,
            background: isAlert
              ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
              : 'linear-gradient(90deg, #10b981, #3b82f6)',
          }}
        />
      </div>

      {/* row-eta: 終了予定 */}
      <EtaRow
        etaStatus={group.etaStatus}
        etaTime={group.etaTime}
        remainingMin={group.etaRemainingMin}
        stdMin={group.stdMin}
        skillCoef={group.skillCoef}
        staff={group.assignedStaff}
        remaining={group.remaining}
      />

      {/* row3: メンバー */}
      <div className="flex justify-between items-center text-3xs mt-1">
        <div className="text-ink-subtle truncate">
          👤 {group.assignedStaff}名
          {group.staffNames.length > 0 && `：${group.staffNames.join('・')}`}
          {group.assignedStaff > 3 && `+${group.assignedStaff - 3}`}
        </div>
      </div>

      {/* Sprint G-5: 全展開時にテーブル単位の内訳ストリップを表示 */}
      {expanded && group.tables.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-surface-border space-y-0.5">
          {group.tables.map((tbl) => (
            <div
              key={tbl}
              className="flex items-center justify-between text-3xs bg-surface-panel/60 rounded px-1.5 py-0.5"
            >
              <span className="font-mono text-ink-subtle">📋 {tbl}</span>
              <span className="text-ink-muted">
                {/* 件数はグループ集計のみ提供されているため均等按分の参考値 */}
                ≒{Math.floor(group.done / group.tables.length)}/
                {Math.floor(group.plan / group.tables.length)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: GroupStatus }) {
  const map: Record<GroupStatus, { bg: string; text: string; label: string }> = {
    working: { bg: 'bg-status-info-bg', text: 'text-status-info', label: '稼働中' },
    done: { bg: 'bg-status-ok-bg', text: 'text-status-ok', label: '✅完了' },
    alert: { bg: 'bg-status-error-bg', text: 'text-status-error', label: '🚨遅延' },
    wait: { bg: 'bg-surface-raised', text: 'text-ink-muted', label: '⏸待機' },
  };
  const { bg, text, label } = map[status];
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-3xs font-bold', bg, text)}>
      {label}
    </span>
  );
}

function EtaRow({
  etaStatus,
  etaTime,
  remainingMin,
  stdMin,
  skillCoef,
  staff,
  remaining,
}: {
  etaStatus: EtaStatus | null;
  etaTime: string | null;
  remainingMin: number | null;
  stdMin: number;
  skillCoef: number;
  staff: number;
  remaining: number;
}) {
  if (!etaStatus) {
    return (
      <div className="flex justify-between items-center bg-surface-base/60 rounded px-1.5 py-1 text-3xs border-l-2 border-surface-border-strong">
        <span className="text-ink-muted">⏱ 終了予定</span>
        <span className="text-ink-muted">—</span>
      </div>
    );
  }

  const styleMap: Record<EtaStatus, { border: string; bg: string; text: string; icon: string }> = {
    ok: { border: 'border-status-ok', bg: '', text: 'text-emerald-300', icon: '⏱' },
    warn: {
      border: 'border-status-warn',
      bg: 'bg-amber-950/40',
      text: 'text-accent-amber',
      icon: '⚠',
    },
    over: {
      border: 'border-status-error',
      bg: 'bg-red-950/40',
      text: 'text-red-300',
      icon: '🔴',
    },
    done: { border: 'border-status-ok', bg: '', text: 'text-emerald-300', icon: '✅' },
  };
  const s = styleMap[etaStatus];

  const tooltip =
    etaStatus === 'done'
      ? '完了'
      : `残件 ${remaining}件 × 標準 ${stdMin}分/件 × 係数 ${skillCoef.toFixed(2)} ÷ 人員 ${staff}名 = 必要 ${remainingMin ?? '—'}分`;

  const remainingText =
    etaStatus === 'done'
      ? '完了'
      : remainingMin !== null
        ? `(${Math.floor(remainingMin / 60)}h${String(remainingMin % 60).padStart(2, '0')}分)`
        : '';

  return (
    <div
      title={tooltip}
      className={cn(
        'flex justify-between items-center rounded px-1.5 py-1 text-3xs border-l-2',
        s.border,
        s.bg,
        'bg-surface-base/60',
      )}
    >
      <span className="text-ink-subtle">{s.icon} 終了予定</span>
      <span className={cn('font-bold tabular-nums font-mono', s.text)}>
        {etaTime ?? '—'} <span className="text-ink-muted font-normal">{remainingText}</span>
      </span>
    </div>
  );
}
