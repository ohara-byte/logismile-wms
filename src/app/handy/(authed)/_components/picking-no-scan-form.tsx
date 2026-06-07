'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HeldResumeModal } from '@/components/inspection/held-resume-modal';
import { CompletedWarningModal } from '@/components/inspection/completed-warning-modal';
import { CancelWarningModal } from '@/components/inspection/cancel-warning-modal';
import { TakeoverConfirmModal } from '@/components/inspection/takeover-confirm-modal';
import { ReprintModal } from '@/components/inspection/reprint-modal';
import { NoticesModal } from '@/components/inspection/notices-modal';
import { useHardwareKeys } from '@/lib/use-hardware-keys';

/**
 * ハンディ用ピッキング№入力フォーム
 *
 * KEYENCE BT-A500 はバーコード読み取り後に Enter キーを送信するので、
 * input への submit イベントだけで動作する。
 *
 * モック準拠（ハンディ検品モック_v0.14.html）:
 *   - 起動直後に「📢 本日の連絡事項」を自動表示（D-4）
 *   - F1 = 連絡事項を再表示（待機画面）
 *   - F2 = QR ラベル再発行モーダル（待機画面）
 *   - 保留中伝票 → HeldResumeModal
 *   - 検品済伝票 → CompletedWarningModal
 */

interface ScannedOrder {
  pkNo: string;
  status: string;
  invoiceNo: string | null;
  destName: string | null;
  holdReason: string | null;
  deleted?: boolean;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deleteReason?: string | null;
  items: Array<{ qty: number; scannedQty: number; forceOk: boolean }>;
  inspSession: {
    completedAt: string | null;
    staffCode?: string | null;
    staff: { code?: string; name: string } | null;
  } | null;
}

interface Props {
  currentStaffCode?: string;
}

export function PickingNoScanForm({ currentStaffCode }: Props = {}) {
  const router = useRouter();
  const [pkNo, setPkNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [heldOrder, setHeldOrder] = useState<ScannedOrder | null>(null);
  const [completedOrder, setCompletedOrder] = useState<ScannedOrder | null>(null);
  const [cancelOrder, setCancelOrder] = useState<ScannedOrder | null>(null);
  /** 2026-05-31: 別担当者が検品中の伝票を引き継ぐ確認モーダル */
  const [takeoverOrder, setTakeoverOrder] = useState<ScannedOrder | null>(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  // D-4: 起動直後に連絡事項を自動表示。
  // 同一セッション内では showNotices で開閉のみ管理（明示的に「再表示」した場合に開く）
  const [showNotices, setShowNotices] = useState(true);
  const noticesAutoShownRef = useRef(true);

  // モーダルが何かしら開いているか
  const anyModalOpen =
    showNotices ||
    heldOrder !== null ||
    completedOrder !== null ||
    cancelOrder !== null ||
    takeoverOrder !== null ||
    reprintOpen;

  // ハードキー（モック準拠 — 待機画面: F1=連絡再表示 / F2=QR再発行 / F3=在庫検品）
  // Sprint Z-1: F3 で在庫検品画面へ遷移（出荷検品とは別フロー）
  useHardwareKeys({
    enabled: !anyModalOpen,
    onF1: () => setShowNotices(true),
    onF2: () => setReprintOpen(true),
    onF3: () => router.push('/handy/stock'),
  });

  // モーダルが全て閉じたら入力にフォーカス回復
  useEffect(() => {
    if (!anyModalOpen) {
      const el = document.querySelector<HTMLInputElement>(
        'input[placeholder="SA01208680006"]',
      );
      el?.focus();
    }
  }, [anyModalOpen]);

  // 一度自動表示したらフラグを倒し、以降の自動再開はしない（明示再表示のみ）
  useEffect(() => {
    if (!showNotices && noticesAutoShownRef.current) {
      noticesAutoShownRef.current = false;
    }
  }, [showNotices]);

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

      // 2026-05-22: キャンセル伝票（論理削除済）は赤背景モーダルで前面表示
      if (order.deleted) {
        setCancelOrder(order);
        return;
      }
      if (order.status === 'held') {
        setHeldOrder(order);
        return;
      }
      if (order.status === 'packed' || order.status === 'shipped') {
        setCompletedOrder(order);
        return;
      }
      // 2026-05-31 現場要望: 別担当者が検品中の伝票は「引き継ぎ確認」モーダルを表示
      const sessionStaffCode = order.inspSession?.staffCode ?? order.inspSession?.staff?.code;
      if (
        order.status === 'inspecting' &&
        sessionStaffCode &&
        currentStaffCode &&
        sessionStaffCode !== currentStaffCode
      ) {
        setTakeoverOrder(order);
        return;
      }
      router.push(`/handy/inspect/${encodeURIComponent(order.pkNo)}`);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 2026-05-31 現場要望: 別担当者の検品セッションを引き継ぐ
   * /api/inspect/start に takeover:true を送ってサーバ側でセッション所有者を更新。
   */
  async function executeTakeover() {
    if (!takeoverOrder) return;
    setBusy(true);
    try {
      const res = await fetch('/api/inspect/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pkNo: takeoverOrder.pkNo, takeover: true }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.message ?? `引き継ぎに失敗しました: HTTP ${res.status}`);
        return;
      }
      const target = takeoverOrder.pkNo;
      setTakeoverOrder(null);
      router.push(`/handy/inspect/${encodeURIComponent(target)}?mode=resume`);
    } catch (e) {
      alert(`引き継ぎエラー: ${String(e)}`);
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
      {showNotices && (
        <NoticesModal
          variant="handy-launch"
          onClose={() => setShowNotices(false)}
        />
      )}
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
        {/* 検品開始ボタン — 本番はバーコードスキャン即発火だが、確認用の手動ボタンを残す。
            QR ラベル再発行は機能キー F2（モック準拠）で起動するため、画面上のボタンは無し。 */}
        <button
          type="submit"
          disabled={busy || !pkNo.trim()}
          className="w-full bg-blue-700 hover:bg-blue-600 text-white rounded-lg py-2.5 text-sm font-bold border border-blue-500 disabled:bg-surface-raised disabled:text-ink-muted disabled:border-surface-border"
        >
          {busy ? '読込中…' : '検品開始 (Enter)'}
        </button>
        <p className="text-3xs text-ink-muted text-center pt-1">
          ⌨ <b className="text-accent-amber">F2</b> = QR ラベル再発行 ／{' '}
          <b className="text-accent-amber">F3</b> = 在庫検品へ
        </p>
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

      {/* キャンセル伝票 警告モーダル（赤背景） */}
      <CancelWarningModal
        open={cancelOrder !== null}
        order={
          cancelOrder
            ? {
                pkNo: cancelOrder.pkNo,
                invoiceNo: cancelOrder.invoiceNo,
                destName: cancelOrder.destName,
                deletedAt: cancelOrder.deletedAt ?? null,
                deletedBy: cancelOrder.deletedBy ?? null,
                deleteReason: cancelOrder.deleteReason ?? null,
              }
            : null
        }
        onClose={() => {
          setCancelOrder(null);
          setPkNo('');
        }}
      />

      {/* 引き継ぎ確認モーダル（別担当者が検品中の場合） */}
      <TakeoverConfirmModal
        open={takeoverOrder !== null}
        order={
          takeoverOrder
            ? {
                pkNo: takeoverOrder.pkNo,
                invoiceNo: takeoverOrder.invoiceNo,
                destName: takeoverOrder.destName,
                currentOwnerName:
                  takeoverOrder.inspSession?.staff?.name ?? null,
                currentOwnerCode:
                  takeoverOrder.inspSession?.staffCode ??
                  takeoverOrder.inspSession?.staff?.code ??
                  null,
                ...computeRatio(takeoverOrder),
                scannedRatio: computeRatio(takeoverOrder).ratio,
              }
            : null
        }
        onTakeover={executeTakeover}
        onCancel={() => setTakeoverOrder(null)}
      />

      <ReprintModal open={reprintOpen} onClose={() => setReprintOpen(false)} />
    </>
  );
}
