/**
 * Button — モック準拠の業務ボタン
 *
 * variant:
 *   - primary  : 青（標準操作）
 *   - secondary: グレー
 *   - success  : 緑（完了系）
 *   - warn     : 橙（強制OK等）
 *   - danger   : 赤（削除等）
 *   - print    : ピンク（QR印刷系）
 *   - ghost    : 罫線のみ
 */

import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'success' | 'warn' | 'danger' | 'print' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const V_CLASSES: Record<Variant, string> = {
  primary:
    'bg-blue-700 hover:bg-blue-600 text-white border border-blue-500 disabled:bg-surface-raised disabled:text-ink-muted disabled:border-surface-border',
  secondary:
    'bg-surface-raised hover:bg-slate-600 text-ink-strong border border-surface-border-strong disabled:bg-surface-panel disabled:text-ink-muted',
  success:
    'bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-500 disabled:bg-surface-raised disabled:text-ink-muted disabled:border-surface-border',
  warn:
    'bg-orange-700 hover:bg-orange-600 text-white border border-orange-500 disabled:bg-surface-raised disabled:text-ink-muted disabled:border-surface-border',
  danger:
    'bg-red-700 hover:bg-red-600 text-white border border-red-500 disabled:bg-surface-raised disabled:text-ink-muted disabled:border-surface-border',
  print:
    'bg-pink-700 hover:bg-pink-600 text-white border border-pink-500 disabled:bg-surface-raised disabled:text-ink-muted disabled:border-surface-border',
  ghost:
    'bg-transparent hover:bg-surface-raised text-ink border border-surface-border-strong disabled:text-ink-muted',
};
const S_CLASSES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs rounded',
  md: 'h-9 px-3.5 text-sm rounded-md',
  lg: 'h-11 px-5 text-base rounded-md',
};

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-bold transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber',
        'disabled:cursor-not-allowed',
        V_CLASSES[variant],
        S_CLASSES[size],
        className,
      )}
    />
  );
}
