'use client';

/**
 * 検品スキャン音 ON/OFF トグルボタン（タブレット・ハンディ共用）
 *
 * 2026-05-23 新規:
 *   検品画面トップに配置するスピーカー切替。
 *   - 状態は親側 `useScanSound` フックが保持（localStorage に永続化）
 *   - タップ範囲 44×44 px 以上を確保（タッチ操作前提）
 *   - variant='handy' は狭い画面用にコンパクト
 */

interface Props {
  enabled: boolean;
  onToggle: () => void;
  variant?: 'tablet' | 'handy';
}

export function SoundToggle({ enabled, onToggle, variant = 'tablet' }: Props) {
  const isHandy = variant === 'handy';

  const sizeClass = isHandy
    ? 'min-w-[44px] min-h-[36px] px-2 py-1 text-2xs'
    : 'min-w-[64px] min-h-[44px] px-3 py-2 text-xs';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={enabled ? 'スキャン音 OFF にする' : 'スキャン音 ON にする'}
      title={enabled ? 'スキャン音 ON（タップで OFF）' : 'スキャン音 OFF（タップで ON）'}
      className={
        sizeClass +
        ' rounded-lg font-bold flex items-center justify-center gap-1 border transition-colors ' +
        (enabled
          ? 'bg-status-ok/20 border-status-ok text-status-ok hover:bg-status-ok/30'
          : 'bg-surface-base border-surface-border text-ink-muted hover:text-ink')
      }
    >
      <span className={isHandy ? 'text-base' : 'text-lg'}>
        {enabled ? '🔊' : '🔇'}
      </span>
      <span>{enabled ? '音 ON' : '音 OFF'}</span>
    </button>
  );
}
