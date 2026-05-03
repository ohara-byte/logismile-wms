'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HeldResumeModal } from '@/components/inspection/held-resume-modal';
import { CompletedWarningModal } from '@/components/inspection/completed-warning-modal';
import { ReprintModal } from '@/components/inspection/reprint-modal';

/**
 * ハンディ用ピッキング№入力フォーム
 *
 * KEYENCE BT-A500 はバーコード読み取り後に Enter キーを送信するので、
 * input への submit イベントだけで動作する。
 *
 * モック準拠（ハンディ検品モック_v0.14.html）:
 *   - F1 / 🖨ボタン → QR 再発行モーダル
 *   - 保留中伝票 → HeldResumeModal
 *   - 検品済伝票 → CompletedWarningModal
 */

interface ScannedOrder {
  pkNo: string;
  status: string;
  invoiceNo: string | null;
  destName: string | null;
  holdReason: string | null;
  items: Array<{ qty: number; scannedQty: number; forceOk: boolean }>;
  inspSession: {
    completedAt: string | null;
    staff: { name: string } | null;
  } | null;
}

export function PickingNoScanForm() {
  const router = useRouter();
  const [pkNo, setPkNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [heldOrder, setHeldOrder] = useState<ScannedOrder | null>(null);
  const [completedOrder, setCompletedOrder] = useState<ScannedOrder | null>(null);
  const [reprintOpen, setReprintOpen] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pkNo.trim()) return;
    setBusy(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(pkNo.trim())}`);
      if (res.status === 404) {
        setErrorMsg('該当する出荷指示が見つかりません');
        return;
      }
      if (!res.ok) {
        setErrorMsg(`エラー: HTTP ${res.status}`);
        return;
      }
      const j = await res.json();
      const order: ScannedOrder = j.data;

      if (order.status === 'held') {
        setHeldOrder(order);
        return;
      }
      if (order.status === 'packed' || order.status === 'shipped') {
        setCompletedOrder(order);
        return;
      }
      router.push(`/handy/inspect/${encodeURIComponent(order.pkNo)}`);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reopenCompleted() {
    if (!completedOrder) return;
    const res = await fetch('/api/inspect/reopen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pkNo: completedOrder.pkNo,
        reason: '現場検品戻し',
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j?.message ?? `エラー: HTTP ${res.status}`);
      return;
    }
    const target = completedOrder.pkNo;
    setCompletedOrder(null);
    router.push(`/handy/inspect/${encodeURIComponent(target)}`);
  }

  function computeRatio(o: ScannedOrder): { ratio: number; itemCount: number } {
    const total = o.items.reduce((s, i) => s + i.qty, 0);
    const done = o.items.reduce(
      (s, i) => s + (i.forceOk ? i.qty : Math.min(i.scannedQty, i.qty)),
      0,
    );
    const ratio = total > 0 ? Math.round((done / total) * 100) : 0;
    return { ratio, itemCount: o.items.length };
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-2">
        <input
          type="text"
          autoFocus
          value={pkNo}
          onChange={(e) => setPkNo(e.target.value)}
          className="w-full bg-surface-panel border-2 border-accent-amber/50 rounded-lg px-3 py-3 text-lg font-mono text-ink-strong text-center tabular-nums focus:outline-none focus:border-accent-amber focus:ring-2 focus:ring-accent-amber/20"
          placeholder="SA01208680006"
        />
        {errorMsg && (
          <div className="text-3xs text-status-error bg-status-error-bg border border-status-error/40 rounded p-2 text-center">
            {errorMsg}
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-1.5">
          <button
            type="submit"
            disabled={busy || !pkNo.trim()}
            className="bg-blue-700 hover:bg-blue-600 text-white rounded-lg py-2.5 text-sm font-bold border border-blue-500 disabled:bg-surface-raised disabled:text-ink-muted disabled:border-surface-border"
          >
            {busy ? '読込中…' : '検品開始 (Enter)'}
          </button>
          <button
            type="button"
            onClick={() => setReprintOpen(true)}
            disabled={busy}
            className="bg-pink-800 hover:bg-pink-700 text-white rounded-lg px-3 py-2.5 text-2xs font-bold border border-pink-500 disabled:opacity-50"
            title="QR ラベル再発行 (F2)"
          >
            🖨
          </button>
        </div>
      </form>

      <HeldResumeModal
        open={heldOrder !== null}
        order={
          heldOrder
            ? {
                pkNo: heldOrder.pkNo,
                invoiceNo: heldOrder.invoiceNo,
                destName: heldOrder.destName,
                holdReason: heldOrder.holdReason,
                ...computeRatio(heldOrder),
                scannedRatio: computeRatio(heldOrder).ratio,
              }
            : null
        }
        onResume={() => {
          if (!heldOrder) return;
          const target = heldOrder.pkNo;
          setHeldOrder(null);
          router.push(`/handy/inspect/${encodeURIComponent(target)}?mode=resume`);
        }}
        onRestart={() => {
          if (!heldOrder) return;
          const target = heldOrder.pkNo;
          setHeldOrder(null);
          router.push(`/handy/inspect/${encodeURIComponent(target)}?mode=restart`);
        }}
        onCancel={() => setHeldOrder(null)}
      />

      <CompletedWarningModal
        open={completedOrder !== null}
        order={
          completedOrder
            ? {
                pkNo: completedOrder.pkNo,
                invoiceNo: completedOrder.invoiceNo,
                destName: completedOrder.destName,
                completedAt: completedOrder.inspSession?.completedAt ?? null,
                staffName: completedOrder.inspSession?.staff?.name ?? null,
                itemCount: completedOrder.items.length,
              }
            : null
        }
        onConfirm={() => setCompletedOrder(null)}
        onReopen={reopenCompleted}
        onCancel={() => setCompletedOrder(null)}
      />

      <ReprintModal open={reprintOpen} onClose={() => setReprintOpen(false)} />
    </>
  );
}
