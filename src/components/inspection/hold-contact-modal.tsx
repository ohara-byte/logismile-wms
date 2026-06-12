'use client';

/**
 * 本部連絡（着信）モーダル（タブレット / ハンディ共用）
 *
 * モック準拠（タブレット検品モック_v0.18.html L1325-1361）。
 *
 * 仕様:
 *   - 4 分類ボタン（のし / 商品 / 入力内容 / WEB）から1つ選択（必須）
 *   - 補足 textarea（任意）
 *   - 送信は POST /api/notices に kind=inbox で投稿
 *   - 管理 PC 側「📢 連絡」タブの 📥 着信 サブタブに表示される
 */

import { useEffect, useState } from 'react';

type Category = 'noshi' | 'product' | 'input' | 'web';

const CATEGORIES: { code: Category; icon: string; label: string }[] = [
  { code: 'noshi', icon: '🎁', label: 'のし' },
  { code: 'product', icon: '📦', label: '商品' },
  { code: 'input', icon: '✏', label: '入力内容' },
  { code: 'web', icon: '🌐', label: 'WEB' },
];

interface Props {
  open: boolean;
  /** 連絡対象の伝票 PkNo（フォールバック・他の識別子が空のときのみタイトルに使用） */
  pkNo: string;
  /** 注文番号（B・2026-06-12：基幹CSV N列。本部連絡の主識別子） */
  orderNo?: string | null;
  /** 顧客コード（B：基幹CSV M列） */
  customerCode?: string | null;
  /** 顧客名（B：届け先名 destName） */
  customerName?: string | null;
  /** 起票者の社員番号（無くても POST は通る） */
  staffCode?: string | null;
  onSent: () => void;
  onCancel: () => void;
}

/**
 * B・2026-06-12：本部連絡の対象識別子を「注文番号 ＋ 顧客コード ＋ 顧客名」で組み立てる。
 * すべて空のときのみ pkNo にフォールバック（本部側が必ず対象を特定できるように）。
 */
function buildOrderLabel(args: {
  pkNo: string;
  orderNo?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
}): string {
  const parts = [
    args.orderNo ? `注文${args.orderNo}` : null,
    args.customerCode || null,
    args.customerName || null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : args.pkNo;
}

export function HoldContactModal({
  open,
  pkNo,
  orderNo,
  customerCode,
  customerName,
  staffCode,
  onSent,
  onCancel,
}: Props) {
  const orderLabel = buildOrderLabel({ pkNo, orderNo, customerCode, customerName });
  const [category, setCategory] = useState<Category | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCategory(null);
      setBody('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  async function send() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'inbox',
          date: new Date().toISOString().slice(0, 10),
          targetType: 'all',
          category,
          // B：本部連絡の対象識別子を 納品書№＋顧客コード＋顧客名 に変更（旧: ピッキング№）
          title: `📥 ${categoryLabel(category)}: ${orderLabel}`,
          body: body.trim() || null,
          senderCode: staffCode ?? null,
          priority: category === 'product' ? 70 : 50,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${r.status}`);
      }
      onSent();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="bg-surface-panel border border-surface-border rounded-2xl shadow-modal max-w-lg w-full p-5">
        <h2 className="text-lg font-bold text-ink-strong mb-1">📢 本部連絡</h2>
        <p className="text-2xs text-ink-subtle mb-2 leading-snug">
          連絡分類を 1 つ選び、必要に応じて補足を入力してください。
          送信先は管理 PC「連絡」タブ。
        </p>
        {/* B：連絡対象（納品書№＋顧客名）を明示。本部側もこの表記で受信する。 */}
        <div className="bg-surface-base border border-surface-border rounded px-3 py-1.5 text-2xs text-ink mb-3">
          <span className="text-ink-muted">対象：</span>
          <b className="text-ink-strong">{orderLabel}</b>
        </div>

        <div className="text-3xs text-ink-muted mb-1 tracking-wider">▼ 分類（必須）</div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => setCategory(c.code)}
              className={`p-2 rounded border ${
                category === c.code
                  ? 'border-accent-amber bg-amber-900 text-amber-100 font-bold'
                  : 'border-surface-border bg-surface-base text-ink-subtle hover:border-accent-amber/60'
              }`}
            >
              <div className="text-2xl leading-none">{c.icon}</div>
              <div className="text-2xs mt-0.5">{c.label}</div>
            </button>
          ))}
        </div>

        <div className="bg-surface-base border-l-2 border-accent-amber rounded px-3 py-1.5 text-2xs text-amber-200 mb-3">
          選択中の分類:{' '}
          <b className="text-accent-amber">
            {category ? categoryLabel(category) : '未選択'}
          </b>
        </div>

        <div className="text-3xs text-ink-muted mb-1 tracking-wider">
          ▼ 補足（任意・写真添付は将来対応）
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          disabled={busy}
          placeholder="例: のし台紙が破損／JANと指示が違う／お客様情報の電話番号が空欄／WEB側のクーポン入力誤り など"
          className="w-full bg-surface-base border border-surface-border rounded px-2 py-1.5 text-xs text-ink resize-none mb-3 disabled:opacity-50"
        />

        {error && (
          <div className="text-2xs bg-status-error-bg text-status-error border border-status-error rounded p-2 mb-3">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded border border-surface-border bg-surface-base text-ink text-xs disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={send}
            disabled={busy || category === null}
            className="px-4 py-2 rounded bg-status-warn text-black text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>📤</span>
            {busy ? '送信中…' : '本部へ送信'}
          </button>
        </div>
      </div>
    </div>
  );
}

function categoryLabel(c: Category): string {
  return CATEGORIES.find((x) => x.code === c)?.label ?? c;
}
