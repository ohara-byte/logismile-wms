'use client';

/**
 * 強制OK モーダル（タブレット / ハンディ共用）
 *
 * モック準拠（タブレット検品モック_v0.18.html L1275-1299）。
 *
 * 仕様:
 *   - R01-R04 を 2x2 ボタンで選択（ハンディは縦並びに切替）
 *   - R04 「その他」を選んだ場合のみコメント textarea が必須
 *   - 「次の伝票以降も継続する（Sticky）」チェック（既定 ON）
 *   - 確定で onConfirm({ code, reason, sticky }) を呼ぶ
 *   - reason は 'Rxx [ラベル or コメント]' 形式で API に送る
 *
 * Sticky 状態の保持は親コンポーネント側の useStickyForceOk() フックで管理。
 */

import { useEffect, useState } from 'react';
import {
  FORCE_REASON_LABELS,
  REASON_REQUIRE_COMMENT,
  type ForceReasonCode,
} from '@/lib/force-ok';

const VISIBLE_CODES: ForceReasonCode[] = ['R01', 'R02', 'R03', 'R04'];

interface Props {
  open: boolean;
  productName?: string;
  /** ハンディなど狭い画面用に縦並びに切替 */
  vertical?: boolean;
  /** Sticky チェックボックスの初期値 */
  defaultSticky?: boolean;
  onConfirm: (args: {
    code: ForceReasonCode;
    reason: string;
    sticky: boolean;
  }) => void;
  onCancel: () => void;
}

export function ForceOkModal({
  open,
  productName,
  vertical = false,
  defaultSticky = true,
  onConfirm,
  onCancel,
}: Props) {
  const [code, setCode] = useState<ForceReasonCode | null>(null);
  const [comment, setComment] = useState('');
  const [sticky, setSticky] = useState(defaultSticky);
  const [busy, setBusy] = useState(false);

  // 開くたびにリセット
  useEffect(() => {
    if (open) {
      setCode(null);
      setComment('');
      setSticky(defaultSticky);
      setBusy(false);
    }
  }, [open, defaultSticky]);

  // Esc キーで閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const requireComment = code ? REASON_REQUIRE_COMMENT[code] : false;
  const canConfirm =
    !busy && code !== null && (!requireComment || comment.trim().length > 0);

  function handleConfirm() {
    if (!canConfirm || !code) return;
    const label = FORCE_REASON_LABELS[code];
    const reason = requireComment
      ? `${code} ${comment.trim()}`
      : `${code} ${label}`;
    setBusy(true);
    onConfirm({ code, reason, sticky });
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="bg-surface-panel border border-status-warn rounded-2xl shadow-modal max-w-md w-full p-5">
        <h2 className="text-lg font-bold text-status-warn mb-1">⚠ 強制検品OK</h2>
        <p className="text-2xs text-ink-subtle mb-3 leading-snug">
          差分がある状態で検品を完了させます。理由コードを選択してください。
          実行内容は全てログに記録されます。
        </p>
        {productName && (
          <div className="text-xs text-ink mb-2 truncate">
            対象: <b className="text-ink-strong">{productName}</b>
          </div>
        )}

        <div
          className={`grid gap-1.5 mb-3 ${
            vertical ? 'grid-cols-1' : 'grid-cols-2'
          }`}
        >
          {VISIBLE_CODES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCode(c)}
              className={`p-2 rounded border text-left transition-colors ${
                code === c
                  ? 'bg-status-warn text-black border-status-warn font-bold'
                  : 'bg-surface-base border-surface-border text-ink hover:border-status-warn'
              }`}
            >
              <div className="font-mono text-sm font-bold leading-none">{c}</div>
              <div className="text-2xs mt-0.5">
                {FORCE_REASON_LABELS[c]}
                {REASON_REQUIRE_COMMENT[c] && (
                  <span className="ml-1 text-[9px] opacity-80">（コメント必須）</span>
                )}
              </div>
            </button>
          ))}
        </div>

        {requireComment && (
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            disabled={busy}
            placeholder="その他理由を入力してください（必須）"
            className="w-full bg-surface-base border border-surface-border rounded px-2 py-1.5 text-sm text-ink resize-none mb-3 disabled:opacity-50"
            autoFocus
          />
        )}

        <label className="flex items-start gap-2 mb-3 cursor-pointer bg-amber-950/40 border border-amber-700 rounded p-2">
          <input
            type="checkbox"
            checked={sticky}
            onChange={(e) => setSticky(e.target.checked)}
            disabled={busy}
            className="mt-0.5 cursor-pointer"
          />
          <div className="leading-tight">
            <div className="text-xs font-bold text-amber-200">
              次の伝票以降も強制検品を継続する（Sticky）
            </div>
            <div className="text-2xs text-amber-200/80 mt-0.5 leading-snug">
              ON にすると、次以降の伝票でも検品漏れを許容して完了させる運用になります。
              画面上部に「強制検品中」バナーが表示されます。
            </div>
          </div>
        </label>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded border border-surface-border bg-surface-base text-ink text-xs disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 rounded bg-status-warn text-black font-bold text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? '実行中…' : '強制OK実行'}
          </button>
        </div>
      </div>
    </div>
  );
}
