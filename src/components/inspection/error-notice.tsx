'use client';

/**
 * エラー表示（タブレット / ハンディ共用）
 *
 * 2026-08-11 新規（現場要望）:
 *   端末のエラーが `text-3xs` の小さな帯で、しかも `HTTP 500` のような英語・コードのまま
 *   出ていたため、現場で「何のエラーか分からず対応できない」状態だった。
 *   CompletedWarningModal（検品済み警告）と同じ「大きな日本語 + 対処」の見せ方に揃える。
 *
 * 2 形態:
 *   - ErrorNoticeModal … 作業を止めるべきエラー（検品開始失敗・完了失敗・通信断など）。
 *                        画面中央に大きく出し、閉じるまで残す。
 *   - ErrorNoticeBar   … スキャン中の一時的なエラー。作業を止めずに大きめの帯で出す。
 *
 * どちらも文言は `toFriendlyError`（src/lib/error-message.ts）で日本語化済みの
 * FriendlyError を受け取る。英語の原文は既定で畳んでおき、問い合わせ時だけ開く。
 */

import type { FriendlyError } from '@/lib/error-message';

interface ModalProps {
  error: FriendlyError | null;
  onClose: () => void;
  /** ハンディは画面が小さいため一段控えめのサイズにする */
  variant?: 'tablet' | 'handy';
  /** 「閉じる」以外の操作を足したい場合（再試行など） */
  action?: { label: string; onClick: () => void };
}

export function ErrorNoticeModal({
  error,
  onClose,
  variant = 'tablet',
  action,
}: ModalProps) {
  if (!error) return null;
  const handy = variant === 'handy';

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="alertdialog"
      aria-modal="true"
    >
      <div
        style={{
          background: '#1e293b',
          border: '2px solid #dc2626',
          borderRadius: 14,
          padding: handy ? 20 : 28,
          width: handy ? 460 : 660,
          maxWidth: '94vw',
          maxHeight: '92vh',
          overflowY: 'auto',
          color: '#f1f5f9',
          boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
        }}
      >
        {/* 見出し：何が起きたか。可能な限り大きく */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <span style={{ fontSize: handy ? 34 : 44, lineHeight: 1 }}>⚠</span>
          <h2
            style={{
              color: '#fecaca',
              fontSize: handy ? 24 : 32,
              fontWeight: 'bold',
              lineHeight: 1.35,
              margin: 0,
            }}
          >
            {error.title}
          </h2>
        </div>

        {/* 対処 */}
        {error.hint && (
          <p
            style={{
              marginTop: 14,
              fontSize: handy ? 15 : 18,
              lineHeight: 1.7,
              color: '#e2e8f0',
              background: 'rgba(127,29,29,0.35)',
              borderRadius: 8,
              padding: handy ? '10px 12px' : '14px 16px',
            }}
          >
            {error.hint}
          </p>
        )}

        {/* 原文（英語・コード）は畳んでおく。現場は見ない／問い合わせ時だけ開く */}
        {error.raw && (
          <details style={{ marginTop: 12 }}>
            <summary
              style={{
                fontSize: 12,
                color: '#94a3b8',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              担当者へ伝える情報（タップで表示）
            </summary>
            <pre
              style={{
                marginTop: 6,
                padding: 10,
                background: '#0f172a',
                borderRadius: 6,
                fontSize: 11,
                color: '#cbd5e1',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {error.raw}
            </pre>
          </details>
        )}

        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            marginTop: handy ? 18 : 24,
          }}
        >
          {action && (
            <button
              onClick={action.onClick}
              style={{
                height: handy ? 48 : 56,
                padding: '0 22px',
                borderRadius: 8,
                background: '#b45309',
                color: '#fff',
                fontWeight: 'bold',
                fontSize: handy ? 15 : 17,
              }}
            >
              {action.label}
            </button>
          )}
          <button
            onClick={onClose}
            autoFocus
            style={{
              height: handy ? 48 : 56,
              padding: '0 28px',
              borderRadius: 8,
              background: '#1d4ed8',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: handy ? 16 : 18,
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

interface BarProps {
  error: FriendlyError | null;
  variant?: 'tablet' | 'handy';
  onDismiss?: () => void;
}

/** スキャン中の一時エラー用。作業を止めないが、従来より大きく日本語で出す。 */
export function ErrorNoticeBar({ error, variant = 'tablet', onDismiss }: BarProps) {
  if (!error) return null;
  const handy = variant === 'handy';

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'rgba(127,29,29,0.85)',
        border: '1px solid #dc2626',
        borderRadius: 8,
        padding: handy ? '8px 10px' : '12px 14px',
      }}
    >
      <span style={{ fontSize: handy ? 20 : 26, lineHeight: 1 }}>⚠</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: '#fee2e2',
            fontSize: handy ? 16 : 20,
            fontWeight: 'bold',
            lineHeight: 1.4,
          }}
        >
          {error.title}
        </div>
        {error.hint && (
          <div
            style={{
              color: '#fecaca',
              fontSize: handy ? 12 : 14,
              lineHeight: 1.5,
              marginTop: 2,
            }}
          >
            {error.hint}
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="閉じる"
          style={{
            color: '#fecaca',
            fontSize: 20,
            padding: '0 6px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
