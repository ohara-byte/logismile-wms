/**
 * Panel — 暗背景上のカード/パネル枠
 *
 * 用途: ダッシュボードの KPI カード、データ表示エリア、フォームコンテナなど
 * デザイン: surface-panel 背景 + surface-border 罫線 + shadow-panel
 *
 * variant:
 *   - default: 通常パネル
 *   - raised:  影を強めた重要パネル
 *   - subtle:  さらに薄い装飾（情報密度高い場所用）
 */

import { cn } from '@/lib/cn';

interface Props {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'raised' | 'subtle';
  /** クリック可能にする場合（ホバーで色を変える） */
  interactive?: boolean;
}

export function Panel({ children, className, variant = 'default', interactive = false }: Props) {
  const base = 'rounded-lg border bg-surface-panel border-surface-border';
  const elev =
    variant === 'raised'
      ? 'shadow-panel'
      : variant === 'subtle'
        ? 'shadow-none'
        : 'shadow-sm';
  const inter = interactive
    ? 'transition-colors cursor-pointer hover:bg-surface-raised'
    : '';
  return <div className={cn(base, elev, inter, className)}>{children}</div>;
}

/** Panel のヘッダ（タイトル＋メタ＋右端アクションスロット） */
interface HeaderProps {
  title: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}
export function PanelHeader({ title, meta, action, className }: HeaderProps) {
  return (
    // モック準拠：半透明の凹み感を出すために bg-surface-base/50 を敷く。
    // 日本語タイトルが大半なので uppercase / tracking-wider は外す（字間が広がりすぎ）。
    <div
      className={cn(
        'flex items-center justify-between px-3 py-1.5 border-b border-surface-border bg-surface-base/50',
        className,
      )}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <h3 className="text-xs font-bold text-accent-amber truncate">
          {title}
        </h3>
        {meta && <span className="text-2xs text-ink-subtle truncate">{meta}</span>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Panel の本体（スクロール対応） */
export function PanelBody({
  children,
  className,
  scroll = false,
}: {
  children: React.ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <div className={cn('p-3', scroll && 'overflow-auto', className)}>{children}</div>
  );
}
