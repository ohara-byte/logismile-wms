'use client';

/**
 * QR ラベル再発行モーダル（タブレット / ハンディ共用）
 *
 * モック準拠（タブレット検品モック_v0.18.html L1554-1574）。
 *
 * 待機画面のメニューから起動。
 * バーコードスキャンで対象伝票を確定 → POST /api/print/qr/reprint。
 *
 * 対象は ピッキングNo or 納品書No のどちらでも可（API 側で受ける形式に応じる）。
 */

import { useCallback, useEffect, useState } from 'react';

interface OrderInfo {
  pkNo: string;
  invoiceNo: string | null;
  destName: string | null;
  qrPrintFlag: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ReprintModal({ open, onClose }: Props) {
  const [scanInput, setScanInput] = useState('');
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setScanInput('');
      setOrder(null);
      setError(null);
      setBusy(false);
      setDone(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const lookup = useCallback(async (value: string) => {
    setError(null);
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      // ピッキングNo として直接照会
      const r = await fetch(`/api/orders/${encodeURIComponent(v)}`);
      if (r.ok) {
        const j = await r.json();
        setOrder({
          pkNo: j.data.pkNo,
          invoiceNo: j.data.invoiceNo,
          destName: j.data.destName,
          qrPrintFlag: j.data.qrPrintFlag,
        });
        return;
      }
      // 404 の場合は納品書 No 検索（部分一致）
      const sr = await fetch(`/api/orders?q=${encodeURIComponent(v)}&limit=2`);
      if (sr.ok) {
        const sj = await sr.json();
        const exact = (sj.data?.items ?? []).find(
          (it: { invoiceNo: string | null }) => it.invoiceNo === v,
        );
        if (exact) {
          setOrder({
            pkNo: exact.pkNo,
            invoiceNo: exact.invoiceNo,
            destName: exact.destName,
            qrPrintFlag: exact.qrPrintFlag,
          });
          return;
        }
      }
      setError(`該当する伝票が見つかりません: ${v}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  function demoScan() {
    setScanInput('SA01208680006');
    lookup('SA01208680006');
  }

  async function doReprint() {
    if (!order) return;
    setBusy(true);
    try {
      const r = await fetch('/api/print/qr/reprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pkNo: order.pkNo }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${r.status}`);
      }
      setDone(true);
      setTimeout(() => onClose(), 1500);
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
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-surface-panel border border-pink-600 rounded-2xl shadow-modal max-w-md w-full p-5">
        <h2 className="text-lg font-bold text-pink-300 mb-1">🖨 QR ラベル 再発行</h2>
        <p className="text-2xs text-ink-subtle mb-3 leading-snug">
          対象伝票をバーコードスキャンで確定してください
          （ピッキングNo または 納品書No）。
        </p>

        {!order ? (
          <div className="bg-surface-base border-2 border-dashed border-pink-600/60 rounded p-6 text-center mb-3">
            <div className="text-5xl animate-pulse">📷</div>
            <div className="text-pink-300 font-bold mt-2">スキャン待機中…</div>
            <div className="text-2xs text-ink-muted mt-1">
              ピッキングNo / 納品書No のバーコードをスキャン
            </div>
            <input
              autoFocus
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  lookup(scanInput);
                }
              }}
              disabled={busy}
              placeholder="またはここに直接入力 + Enter"
              className="w-full mt-3 bg-surface-panel border border-surface-border rounded px-2 py-1.5 text-sm text-ink font-mono text-center disabled:opacity-50"
            />
          </div>
        ) : (
          <div className="bg-surface-base border-l-4 border-pink-600 rounded p-3 mb-3">
            <div className="text-2xs text-ink-subtle">確定した伝票</div>
            <div className="font-mono text-2xl font-bold text-accent-amber tabular-nums mt-0.5">
              {order.pkNo}
            </div>
            <div className="text-2xs text-ink mt-1">
              {order.destName ?? '—'} ／ 納品書: {order.invoiceNo ?? '—'}
            </div>
            {!order.qrPrintFlag && (
              <div className="text-2xs text-status-warn mt-1">
                ⚠ QR印刷フラグが OFF です。任意印刷扱いになります。
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="text-2xs bg-status-error-bg text-status-error border border-status-error rounded p-2 mb-3">
            {error}
          </div>
        )}
        {done && (
          <div className="text-2xs bg-emerald-900/40 text-emerald-200 border border-status-ok rounded p-2 mb-3">
            ✅ 再発行を送信しました
          </div>
        )}

        <div className="flex gap-2 justify-end flex-wrap">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-2 rounded border border-surface-border bg-surface-base text-ink text-xs disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={demoScan}
            disabled={busy}
            className="px-3 py-2 rounded border border-surface-border bg-surface-base text-ink-subtle text-xs hover:text-ink disabled:opacity-50"
          >
            （デモ）スキャン
          </button>
          <button
            onClick={doReprint}
            disabled={!order || busy || done}
            className="px-3 py-2 rounded bg-pink-700 text-white text-xs font-bold hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🖨 発行する
          </button>
        </div>
      </div>
    </div>
  );
}
