'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HeldResumeModal } from '@/components/inspection/held-resume-modal';
import { CompletedWarningModal } from '@/components/inspection/completed-warning-modal';
import { CancelWarningModal } from '@/components/inspection/cancel-warning-modal';
import { TakeoverConfirmModal } from '@/components/inspection/takeover-confirm-modal';
import { ReprintModal } from '@/components/inspection/reprint-modal';
import { NoticesModal } from '@/components/inspection/notices-modal';

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
  // 起動直後に「📢 本日の連絡事項」を自動表示（ハンディの idle 画面と同等。D-4）。
  //   未読が無ければ NoticesModal 側で即 onClose されるため邪魔にならない。
  //   タブレットはハードキー（F1）が無いため、再表示は画面右上のボタンで行う。
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

      // 状態によって挙動を切替（モック準拠 タブレット v0.18 L2694, L2779）
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
      router.push(`/tablet/inspect/${encodeURIComponent(order.pkNo)}`);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 2026-05-31 現場要望: 別担当者の検品セッションを引き継ぐ
   * /api/inspect/start に takeover:true を送ってサーバ側でセッション所有者を更新。
   * 成功したら通常の検品画面へ遷移（mode=resume で復元）。
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
      router.push(`/tablet/inspect/${encodeURIComponent(target)}?mode=resume`);
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
    router.push(`/tablet/inspect/${encodeURIComponent(target)}`);
  }

  // 共通: スキャンされた held/completed 用のサマリ計算
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
      {/* 起動時の連絡事項モーダル（管理 PC からの「連絡事項」を表示） */}
      {showNotices && (
        <NoticesModal
          variant="tablet-launch"
          onClose={() => setShowNotices(false)}
        />
      )}

      {/* 📢 連絡 再表示ボタン（タブレットはハードキーが無いため画面ボタンで再表示） */}
      <button
        type="button"
        onClick={() => setShowNotices(true)}
        disabled={busy}
        title="本日の連絡事項を再表示"
        style={{
          position: 'absolute',
          top: 16,
          right: 200,
          background: '#475569',
          color: '#fff',
          padding: '10px 16px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          zIndex: 5,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
        className="hover:brightness-110 disabled:opacity-50"
      >
        <span style={{ fontSize: 18 }}>📢</span>
        連絡
      </button>

      {/* V-2 修正: QR再発行ボタンを idle 領域の絶対右上に配置（親が position:relative） */}
      <button
        type="button"
        onClick={() => setReprintOpen(true)}
        disabled={busy}
        title="QR ラベル再発行"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: '#db2777',
          color: '#fff',
          padding: '10px 16px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          zIndex: 5,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
        className="hover:brightness-110 disabled:opacity-50"
      >
        <span style={{ fontSize: 18 }}>🖨</span>
        QRラベル再発行
      </button>

      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="text"
          autoFocus
          value={pkNo}
          onChange={(e) => setPkNo(e.target.value)}
          className="w-full bg-surface-panel border-2 border-accent-amber/50 rounded-lg px-4 py-4 text-2xl font-mono text-ink-strong text-center tabular-nums focus:outline-none focus:border-accent-amber focus:ring-4 focus:ring-accent-amber/20"
          placeholder="SA01208680006"
        />
        {errorMsg && (
          <div className="text-xs text-status-error bg-status-error-bg border border-status-error/40 rounded p-2.5 text-center">
            {errorMsg}
          </div>
        )}
        {/* スキャン即進行が本番想定。テスト用のフォールバックボタンも残す */}
        <button
          type="submit"
          disabled={busy || !pkNo.trim()}
          className="w-full bg-blue-700 hover:bg-blue-600 text-white rounded-lg py-3 text-base font-bold border border-blue-500 disabled:bg-surface-raised disabled:text-ink-muted disabled:border-surface-border"
        >
          {busy ? '読み込み中…' : '検品開始（バーコードスキャンで自動）'}
        </button>
      </form>

      {/* 保留中伝票 復帰モーダル */}
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
          router.push(`/tablet/inspect/${encodeURIComponent(target)}?mode=resume`);
        }}
        onRestart={() => {
          if (!heldOrder) return;
          const target = heldOrder.pkNo;
          setHeldOrder(null);
          router.push(`/tablet/inspect/${encodeURIComponent(target)}?mode=restart`);
        }}
        onCancel={() => setHeldOrder(null)}
      />

      {/* 検品済み 警告モーダル */}
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

      {/* QR 再発行モーダル */}
      <ReprintModal open={reprintOpen} onClose={() => setReprintOpen(false)} />
    </>
  );
}
