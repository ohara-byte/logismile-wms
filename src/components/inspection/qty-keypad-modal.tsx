'use client';

/**
 * 数量入力キーパッドモーダル（タブレット / ハンディ共用）
 *
 * モック準拠（タブレット検品モック_v0.18.html L1396-1431）。
 *
 * 仕様:
 *   - 商品名・商品コード・JAN・既スキャン数 / 全数 / 残数 を表示
 *   - 数字キー 0-9 + CE + ←
 *   - 入力中もリアルタイムで残数オーバー検知（赤表示）
 *   - 確定で onConfirm(addedQty) を呼ぶ。0 や残数超過は不可
 *   - Esc / 背景クリックでキャンセル
 *
 * 実装メモ:
 *   - 入力は加算方式（既存 scannedQty に足す）
 *   - 「キーパッドを開く」のは ScanLine の数量バッジクリック
 */

import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  productName: string;
  productCode: string;
  productJan: string | null;
  alreadyScanned: number;
  totalQty: number;
  onConfirm: (addedQty: number) => Promise<void> | void;
  onCancel: () => void;
  /**
   * Sprint Y-14: ハンディの数字キー押下で keypad を起動した際に、
   * トリガーとなった数字を初期値として反映させるための prop。
   * 例: 数字「3」キー押下 → setQtyTarget(item) + initialDigit=3 → keypad の表示値が "3" で開く
   */
  initialDigit?: number;
}

export function QtyKeypadModal({
  open,
  productName,
  productCode,
  productJan,
  alreadyScanned,
  totalQty,
  onConfirm,
  onCancel,
  initialDigit,
}: Props) {
  const [buf, setBuf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remain = Math.max(totalQty - alreadyScanned, 0);
  const value = buf === '' ? 0 : parseInt(buf, 10);
  // 残数超過は確定不可（エラー扱いを継続）。残数内であれば 10 以上でも入力可。
  const isOver = value > remain;
  const canConfirm = !busy && value > 0 && !isOver;

  // open のたびに初期化（initialDigit があれば反映）
  useEffect(() => {
    if (open) {
      const seed =
        typeof initialDigit === 'number' &&
        Number.isFinite(initialDigit) &&
        initialDigit >= 0 &&
        initialDigit <= 9
          ? String(initialDigit)
          : '';
      setBuf(seed);
      setError(null);
      setBusy(false);
    }
    // initialDigit はモーダル open のたびに 1 度だけ反映する想定なので依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc キャンセル / 物理キーボード入力対応
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key === 'Enter') {
        if (canConfirm) handleConfirm();
        return;
      }
      if (e.key === 'Backspace') {
        setBuf((b) => b.slice(0, -1));
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        pushDigit(e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy, canConfirm]);

  function pushDigit(d: string) {
    setBuf((prev) => {
      if (prev.length >= 3) return prev;
      const next = (prev === '0' ? '' : prev) + d;
      return next;
    });
  }

  async function handleConfirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(value);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="bg-surface-panel border border-surface-border rounded-2xl shadow-modal max-w-md w-full p-5">
        <h2 className="text-lg font-bold text-ink-strong mb-1">🔢 残数を入力</h2>
        <p className="text-2xs text-ink-subtle mb-3 leading-snug">
          スキャンしていない<b>残り個数</b>を入力してください。
          既存スキャン数に加算されます（残数超過は不可）。
        </p>

        {/* 対象商品情報 */}
        <div className="bg-surface-base border border-surface-border rounded p-2 mb-3">
          <div className="text-sm font-bold text-ink-strong truncate">{productName}</div>
          <div className="text-2xs text-ink-muted font-mono truncate">
            構成商品コード: {productCode}
            {productJan && ` ／ JAN: ${productJan}`}
          </div>
          <div className="text-xs text-amber-200 mt-1">
            既スキャン <b className="tabular-nums">{alreadyScanned}</b> / 全{' '}
            <b className="tabular-nums">{totalQty}</b> →{' '}
            <b className="text-accent-amber tabular-nums">残り {remain} 個</b>
          </div>
        </div>

        {/* 数値表示 */}
        <div
          className={`text-center py-3 rounded border bg-surface-base mb-2 ${
            isOver ? 'border-status-error' : 'border-surface-border'
          }`}
        >
          <span
            className={`text-5xl font-bold tabular-nums font-mono ${
              isOver ? 'text-status-error' : 'text-accent-amber'
            }`}
          >
            {value}
          </span>
          <small className="text-xs text-ink-muted ml-2">（残 {remain}）</small>
        </div>

        {/* エラー表示 — 残数超過は確定不可 */}
        {(isOver || error) && (
          <div className="bg-red-900/40 text-red-200 border border-status-error/40 rounded px-3 py-2 mb-2 text-xs font-bold">
            {error
              ? `⚠ ${error}`
              : `⚠ 入力値 ${value} は残数 ${remain} を超えています`}
          </div>
        )}

        {/* キーパッド */}
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          {(['7', '8', '9', '4', '5', '6', '1', '2', '3'] as const).map((d) => (
            <KeyButton key={d} onClick={() => pushDigit(d)} disabled={busy}>
              {d}
            </KeyButton>
          ))}
          <KeyButton variant="util" onClick={() => setBuf('')} disabled={busy}>
            CE
          </KeyButton>
          <KeyButton onClick={() => pushDigit('0')} disabled={busy}>
            0
          </KeyButton>
          <KeyButton
            variant="util"
            onClick={() => setBuf((b) => b.slice(0, -1))}
            disabled={busy}
          >
            ←
          </KeyButton>
        </div>

        {/* アクション */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded border border-surface-border bg-surface-base text-ink text-sm disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-5 py-2 rounded bg-status-ok text-white text-sm font-bold hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <span>✓</span>
            {busy ? '送信中…' : '確定'}
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyButton({
  onClick,
  variant,
  disabled,
  children,
}: {
  onClick: () => void;
  variant?: 'util';
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    variant === 'util'
      ? 'bg-surface-raised border-surface-border text-ink-muted hover:border-accent-amber'
      : 'bg-surface-base border-surface-border text-ink-strong hover:border-accent-amber active:bg-surface-raised';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-14 rounded border text-2xl font-bold tabular-nums font-mono transition-colors disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}
