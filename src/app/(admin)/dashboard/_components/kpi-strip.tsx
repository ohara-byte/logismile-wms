'use client';

/**
 * ダッシュボード KPI ストリップ（4 枚）
 *  - 全体進捗（青）
 *  - 予定数段階バー（オレンジ、★ 1.6 倍幅）
 *  - 18:00 完了予測（緑）
 *  - 強制OK 未承認（赤）
 */

import { cn } from '@/lib/cn';

interface Stage {
  hour: number;
  target: number;
  status: 'done' | 'current' | 'wait';
}

interface OverallData {
  total: number;
  packed: number;
  completionRate: number;
  forceOkCount: number;
  forceOkPending: number;
  forceOkByReason: Record<string, number>;
  planDelta: number;
  etaCompletion: string | null;
  etaDeltaMin: number | null;
  stages: Stage[];
}

interface Props {
  overall: OverallData;
}

export function KpiStrip({ overall }: Props) {
  const ratio = overall.total > 0 ? overall.packed / overall.total : 0;

  return (
    <div className="grid gap-2 h-full" style={{ gridTemplateColumns: '1fr 1.6fr 1fr 1fr' }}>
      {/* 全体進捗 */}
      <KpiCard tone="info" label="全体進捗">
        <div className="flex items-baseline">
          {/* モック準拠：KPI 値は 22px（text-2xl=24px だと密度過多） */}
          <span className="text-[22px] leading-none font-bold text-ink-strong tabular-nums">
            {overall.completionRate}
          </span>
          <span className="text-2xs text-ink-subtle ml-0.5">%</span>
        </div>
        <div className="text-3xs text-ink-subtle mt-0.5">
          <span className="tabular-nums">{overall.packed.toLocaleString()}</span> /{' '}
          <span className="tabular-nums">{overall.total.toLocaleString()}</span> 件{' '}
          <PlanDeltaBadge delta={overall.planDelta} />
        </div>
      </KpiCard>

      {/* 予定数段階バー */}
      <KpiCard tone="warn" label="予定数段階バー" className="px-3">
        <StageBar
          packed={overall.packed}
          total={overall.total}
          stages={overall.stages}
          ratio={ratio}
        />
      </KpiCard>

      {/* 17:00 完了予測（締切17時・2026-07-01変更） */}
      <KpiCard tone="ok" label="17:00 完了予測">
        <div className="text-[22px] leading-none font-bold text-ink-strong tabular-nums font-mono">
          {overall.etaCompletion ?? '—'}
        </div>
        <div className="text-3xs text-ink-subtle mt-0.5">
          {overall.etaDeltaMin === null ? (
            '算出不能（実績データ不足）'
          ) : overall.etaDeltaMin <= 0 ? (
            <span>
              現ペース維持で <b className="text-status-ok">{Math.abs(overall.etaDeltaMin)}分前倒し</b>
              達成見込
            </span>
          ) : (
            <span>
              <b className="text-status-error">{overall.etaDeltaMin}分超過</b>の見込
            </span>
          )}
        </div>
      </KpiCard>

      {/* 強制OK 未承認 */}
      <KpiCard tone="error" label="強制OK / 未承認">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] leading-none font-bold text-ink-strong tabular-nums">
            {overall.forceOkCount}
          </span>
          <span className="text-2xs text-ink-subtle">件</span>
          <span className="text-2xs text-red-300 ml-1 tabular-nums">
            / {overall.forceOkPending} 未承認
          </span>
        </div>
        <div className="text-3xs text-ink-subtle mt-0.5">
          {Object.keys(overall.forceOkByReason).length === 0
            ? '理由別内訳は実装中（R02/R99/R04 等）'
            : Object.entries(overall.forceOkByReason)
                .map(([k, v]) => `${k} ${v}`)
                .join('・')}
        </div>
      </KpiCard>
    </div>
  );
}

function KpiCard({
  label,
  children,
  tone,
  className,
}: {
  label: string;
  children: React.ReactNode;
  tone: 'info' | 'warn' | 'ok' | 'error';
  className?: string;
}) {
  const toneCls = {
    info: 'border-l-status-info',
    warn: 'border-l-status-warn',
    ok: 'border-l-status-ok',
    error: 'border-l-status-error',
  }[tone];
  return (
    <div
      className={cn(
        'bg-surface-panel border border-surface-border border-l-4 rounded-md p-2.5 flex flex-col justify-between',
        toneCls,
        className,
      )}
    >
      {/* モック準拠：日本語ラベルなので uppercase/tracking-wider は外し、フォントは 10px に */}
      <div className="text-2xs text-ink-subtle font-bold">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function PlanDeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-ink-muted">計画通り</span>;
  const positive = delta > 0;
  return (
    <span className={positive ? 'text-status-ok' : 'text-status-error'}>
      {positive ? '▲' : '▼'} 計画比 {positive ? '+' : ''}
      {delta}%
    </span>
  );
}

function StageBar({
  packed,
  total,
  stages,
  ratio,
}: {
  packed: number;
  total: number;
  stages: Stage[];
  ratio: number;
}) {
  // 18:00 マーカーはバー右端なので除外
  const innerStages = stages.filter((s) => s.hour < 18);

  // 現在の目標との差分（最直近の current ステージ）
  const currentStage = stages.find((s) => s.status === 'current') ?? stages[0];
  const delta = currentStage ? packed - currentStage.target : 0;

  // Sprint Y-13: カード上部のラベル「予定数段階バー」と内部テキストが重なっていたので、
  //   内部の同名ラベルを撤去し、現在/目標 のみを右寄せ表示
  return (
    <div className="w-full">
      <div className="flex justify-end text-3xs mb-1">
        <span className="text-accent-amber font-bold tabular-nums">
          現在 {packed.toLocaleString()} / 目標 {currentStage?.target.toLocaleString() ?? '—'}
          （{delta >= 0 ? '+' : ''}
          {delta}）
        </span>
      </div>
      <div className="relative h-5 bg-surface-base border border-surface-border rounded overflow-hidden">
        {/* 進捗フィル */}
        <div
          className="absolute left-0 top-0 bottom-0 transition-all duration-500"
          style={{
            width: `${Math.min(100, ratio * 100)}%`,
            background: 'linear-gradient(90deg, #10b981, #3b82f6)',
          }}
        />
        {/* 縦マーカー */}
        {innerStages.map((s) => {
          const pct = total > 0 ? (s.target / total) * 100 : 0;
          const color =
            s.status === 'done'
              ? '#10b981'
              : s.status === 'current'
                ? '#fbbf24'
                : '#94a3b8';
          return (
            <div
              key={s.hour}
              className="absolute top-0 bottom-0 w-0.5"
              style={{ left: `${pct}%`, background: color, opacity: 0.85 }}
            />
          );
        })}
      </div>
      {/* 段階ティック */}
      <div className="flex justify-between text-3xs mt-1.5">
        {stages.map((s) => (
          <div key={s.hour} className="flex flex-col items-center gap-0.5">
            <span className="text-ink-subtle font-bold tabular-nums">{s.hour}:00</span>
            <span className="text-ink-muted tabular-nums">{s.target.toLocaleString()}</span>
            <StageStatusBadge status={s.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StageStatusBadge({ status }: { status: 'done' | 'current' | 'wait' }) {
  const cls =
    status === 'done'
      ? 'bg-status-ok-bg text-status-ok'
      : status === 'current'
        ? 'bg-status-warn-bg text-accent-amber'
        : 'bg-surface-raised text-ink-muted';
  const label = status === 'done' ? '達成' : status === 'current' ? '進行中' : '待機';
  return (
    <span className={cn('px-1 py-px rounded text-3xs font-bold', cls)}>{label}</span>
  );
}
