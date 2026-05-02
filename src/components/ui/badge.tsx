/**
 * Badge — ステータスピル / カテゴリラベル
 *
 * モック準拠の status バッジバリエーション
 */

import { cn } from '@/lib/cn';

type Variant =
  | 'working'
  | 'done'
  | 'wait'
  | 'alert'
  | 'info'
  | 'warn'
  | 'error'
  | 'print'
  | 'frozen'
  | 'noshi'
  | 'neutral';

const VARIANT_CLASSES: Record<Variant, string> = {
  working: 'bg-status-info-bg text-status-info border border-status-info/40',
  done: 'bg-status-ok-bg text-status-ok border border-status-ok/40',
  wait: 'bg-surface-raised text-ink-subtle border border-surface-border',
  alert: 'bg-status-error-bg text-status-error border border-status-error/40',
  info: 'bg-status-info-bg text-status-info border border-status-info/40',
  warn: 'bg-status-warn-bg text-status-warn border border-status-warn/40',
  error: 'bg-status-error-bg text-status-error border border-status-error/40',
  print: 'bg-print-bg text-print-light border border-print/40',
  frozen: 'bg-frozen-bg text-frozen-light border border-frozen/40',
  noshi: 'bg-pink-950 text-pink-300 border border-pink-700/40',
  neutral: 'bg-surface-raised text-ink-subtle border border-surface-border',
};

interface Props {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
  size?: 'sm' | 'md';
}

export function Badge({ children, variant = 'neutral', className, size = 'sm' }: Props) {
  const sizeCls = size === 'md' ? 'px-2.5 py-0.5 text-xs' : 'px-1.5 py-0.5 text-3xs';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded font-bold uppercase tracking-wide',
        VARIANT_CLASSES[variant],
        sizeCls,
        className,
      )}
    >
      {children}
    </span>
  );
}
