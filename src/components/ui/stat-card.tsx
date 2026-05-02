/**
 * StatCard — KPI 表示カード（ダッシュボード等で使用）
 *
 * モック準拠: 左に色付きのアクセントボーダー、上に小ラベル、下に大数値
 */

import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'error' | 'amber' | 'print';

const TONE_BORDER: Record<Tone, string> = {
  neutral: 'border-l-surface-border-strong',
  info: 'border-l-status-info',
  ok: 'border-l-status-ok',
  warn: 'border-l-status-warn',
  error: 'border-l-status-error',
  amber: 'border-l-accent-amber',
  print: 'border-l-print',
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-strong',
  info: 'text-status-info',
  ok: 'text-status-ok',
  warn: 'text-status-warn',
  error: 'text-status-error',
  amber: 'text-accent-amber',
  print: 'text-print-light',
};

interface Props {
  label: string;
  value: React.ReactNode;
  meta?: React.ReactNode;
  tone?: Tone;
  className?: string;
}

export function StatCard({ label, value, meta, tone = 'neutral', className }: Props) {
  return (
    <div
      className={cn(
        'bg-surface-panel border border-surface-border border-l-4 rounded-md p-3',
        TONE_BORDER[tone],
        className,
      )}
    >
      <div className="text-2xs text-ink-subtle uppercase tracking-wider">{label}</div>
      <div className={cn('text-2xl font-bold tabular-nums mt-0.5', TONE_TEXT[tone])}>
        {value}
      </div>
      {meta && <div className="text-2xs text-ink-muted mt-1">{meta}</div>}
    </div>
  );
}
