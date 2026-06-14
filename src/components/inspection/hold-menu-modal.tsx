'use client';

/**
 * 伝票保留メニュー モーダル（タブレット / ハンディ共用）
 *
 * モック準拠（タブレット検品モック_v0.18.html L1303-1323）。
 *
 * F5 キー or 中断ボタンで起動。3 択メニュー:
 *   - 検品保留 (insp): スキャン状態を保持して中断（後で再開）
 *   - 検品中断 (release): 途中までの検品を破棄して未検品に戻す（確認あり）
 *   - 本部連絡 (contact): 連絡分類モーダルへ遷移
 */

import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  onSelectInspectionHold: () => void;
  onSelectRelease: () => void;
  onSelectContact: () => void;
  onCancel: () => void;
}

export function HoldMenuModal({
  open,
  onSelectInspectionHold,
  onSelectRelease,
  onSelectContact,
  onCancel,
}: Props) {
  // 中断（破棄）は破壊的なので、確認ステップを挟む（ユーザー要望：確認ボタン）。
  const [confirmingRelease, setConfirmingRelease] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmingRelease(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-surface-panel border border-surface-border rounded-2xl shadow-modal max-w-md w-full p-5">
        {confirmingRelease ? (
          <>
            <h2 className="text-lg font-bold text-status-error mb-1">⚠ 検品中断（破棄）の確認</h2>
            <p className="text-xs text-ink-subtle mb-4 leading-relaxed">
              途中までの検品内容を<strong className="text-status-error">破棄</strong>し、この伝票を
              <strong>未検品</strong>に戻します（ピッキングNoから最初からやり直しになります）。
              保持したい場合は「検品保留」を使ってください。よろしいですか？
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmingRelease(false)}
                className="px-4 py-2 rounded border border-surface-border bg-surface-base text-ink text-xs"
              >
                やめる
              </button>
              <button
                onClick={onSelectRelease}
                className="px-4 py-2 rounded bg-status-error text-white text-xs font-bold"
              >
                破棄して未検品に戻す
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-ink-strong mb-1">⏸ 伝票保留メニュー</h2>
            <p className="text-2xs text-ink-subtle mb-4">
              この伝票の処理を中断します。保留＝保持／中断＝破棄。理由を選択してください。
            </p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <MenuButton
                icon="⏸"
                title="検品保留"
                desc={'スキャン状態を保持\nして一時中断'}
                onClick={onSelectInspectionHold}
                tone="warn"
              />
              <MenuButton
                icon="🗑"
                title="検品中断"
                desc={'途中検品を破棄して\n未検品に戻す'}
                onClick={() => setConfirmingRelease(true)}
                tone="danger"
              />
              <MenuButton
                icon="📢"
                title="本部連絡"
                desc={'のし／商品／入力\n／WEB を連絡'}
                onClick={onSelectContact}
                tone="info"
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded border border-surface-border bg-surface-base text-ink text-xs"
              >
                キャンセル
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MenuButton({
  icon,
  title,
  desc,
  onClick,
  tone,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
  tone: 'warn' | 'info' | 'danger';
}) {
  const cls =
    tone === 'warn'
      ? 'bg-amber-950/30 border-status-warn text-amber-100 hover:bg-amber-900'
      : tone === 'danger'
        ? 'bg-rose-950/30 border-status-error text-rose-100 hover:bg-rose-900'
        : 'bg-blue-950/30 border-status-info text-blue-100 hover:bg-blue-900';
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded border ${cls} text-center transition-colors`}
    >
      <div className="text-3xl leading-none">{icon}</div>
      <div className="text-base font-bold mt-1">{title}</div>
      <div className="text-2xs opacity-80 mt-0.5 whitespace-pre-line">{desc}</div>
    </button>
  );
}
