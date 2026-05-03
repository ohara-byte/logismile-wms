'use client';

/**
 * ハンディ検品画面（モック準拠 / Phase 7-4）
 *
 * KEYENCE BT-A500 (480×800px 想定) の縦長コンパクトレイアウト。
 * - 起動時 連絡事項モーダル → のし確認モーダル
 * - 検品: 進捗チップ + 商品リスト（縦スクロール） + スキャン入力
 * - 全件完了 → 同梱物確認 → 納品書スキャン → 完了
 * - 全モーダルは Enter キーで進行
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { NoticesModal } from '@/components/inspection/notices-modal';
import { NoshiConfirmationModal } from '@/components/inspection/noshi-confirmation-modal';
import { AccompaniesModal } from '@/components/inspection/accompanies-modal';
import { ForceOkModal } from '@/components/inspection/force-ok-modal';
import { QtyKeypadModal } from '@/components/inspection/qty-keypad-modal';
import { HoldMenuModal } from '@/components/inspection/hold-menu-modal';
import { HoldContactModal } from '@/components/inspection/hold-contact-modal';
import { ReprintModal } from '@/components/inspection/reprint-modal';
import { useStickyForceOk } from '@/lib/use-sticky-force-ok';
import { useHardwareKeys } from '@/lib/use-hardware-keys';

export interface InspectionItem {
  id: number;
  productCode: string;
  productName: string;
  productJan: string | null;
  productFrozen: boolean;
  qty: number;
  scannedQty: number;
  forceOk: boolean;
  forceReason: string | null;
}

export interface InspectionOrder {
  id: string;
  pkNo: string;
  status: string;
  qrPrintFlag: boolean;
  invoiceNo: string | null;
  noshiName: string | null;
  destName: string | null;
  destZip: string | null;
  destAddr: string | null;
  carrier: { code: string; name: string; short: string | null; cool: boolean } | null;
  items: InspectionItem[];
}

interface Props {
  order: InspectionOrder;
  employee: {
    staffCode: string;
    empCode: string;
    name: string;
    deviceCode: string;
  } | null;
}

type ScanResult = 'matched' | 'over_scan' | 'not_found' | 'already_done';
type FlashColor = 'green' | 'red' | 'blue' | null;

export function HandyInspectionScreen({ order: initialOrder, employee }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState(initialOrder);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [boxCode, setBoxCode] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ result: ScanResult; itemId: number | null } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [completionInfo, setCompletionInfo] = useState<{
    durationSec: number;
    qrPrintFlag: boolean;
    print: { ok: boolean; dryRun: boolean } | null;
  } | null>(null);

  // 入力モード
  const [scanMode, setScanMode] = useState<'product' | 'invoice'>('product');

  // フラッシュアニメ
  const [flash, setFlash] = useState<FlashColor>(null);

  // モーダル制御
  const [showNotices, setShowNotices] = useState(true);
  const [showNoshi, setShowNoshi] = useState(false);
  const [showAccompanies, setShowAccompanies] = useState(false);
  const [accompaniesConfirmed, setAccompaniesConfirmed] = useState(false);
  const [forceTarget, setForceTarget] = useState<InspectionItem | null>(null);
  const [qtyTarget, setQtyTarget] = useState<InspectionItem | null>(null);
  const [holdMenuOpen, setHoldMenuOpen] = useState(false);
  const [holdContactOpen, setHoldContactOpen] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);

  // 選択行（Up/Down で移動、Enter or Trigger で +1 スキャン）
  const [selectedRow, setSelectedRow] = useState<number>(-1);

  // Sticky 強制検品モード（A-15）
  const sticky = useStickyForceOk();

  const scanInputRef = useRef<HTMLInputElement>(null);

  const allInspected = order.items.every((it) => it.forceOk || it.scannedQty >= it.qty);

  const anyModalOpen =
    showNotices ||
    showNoshi ||
    showAccompanies ||
    forceTarget !== null ||
    qtyTarget !== null ||
    holdMenuOpen ||
    holdContactOpen ||
    reprintOpen;

  const triggerFlash = useCallback((color: FlashColor) => {
    setFlash(color);
    setTimeout(() => setFlash(null), 500);
  }, []);

  // セッション開始
  useEffect(() => {
    if (sessionId || completed) return;
    fetch('/api/inspect/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkNo: order.pkNo }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.data?.id) {
          setSessionId(j.data.id);
          if (order.qrPrintFlag) setShowNoshi(true);
        } else setErrorMsg(j.message ?? 'セッション開始に失敗');
      })
      .catch((e) => setErrorMsg(String(e)));
  }, [order.pkNo, order.qrPrintFlag, sessionId, completed]);

  // モーダル閉じたらフォーカス回復
  useEffect(() => {
    if (!showNotices && !showNoshi && !showAccompanies) {
      scanInputRef.current?.focus();
    }
  }, [showNotices, showNoshi, showAccompanies]);

  // 全件完了で自動的に納品書モードに
  useEffect(() => {
    if (allInspected && scanMode === 'product') setScanMode('invoice');
    else if (!allInspected && scanMode === 'invoice') setScanMode('product');
  }, [allInspected, scanMode]);

  async function refreshOrder() {
    const res = await fetch(`/api/orders/${encodeURIComponent(order.pkNo)}`);
    if (!res.ok) return;
    const j = await res.json();
    if (j.data) {
      setOrder({
        ...order,
        items: j.data.items.map((it: {
          id: number;
          productCode: string;
          productName: string;
          qty: number;
          scannedQty: number;
          forceOk: boolean;
          forceReason: string | null;
          product: { jan: string | null; frozen: boolean };
        }) => ({
          id: it.id,
          productCode: it.productCode,
          productName: it.productName,
          productJan: it.product.jan,
          productFrozen: it.product.frozen,
          qty: it.qty,
          scannedQty: it.scannedQty,
          forceOk: it.forceOk,
          forceReason: it.forceReason,
        })),
        qrPrintFlag: j.data.qrPrintFlag,
        invoiceNo: j.data.invoiceNo,
        status: j.data.status,
      });
    }
  }

  async function onScan(e: React.FormEvent) {
    e.preventDefault();
    const value = scanInput.trim();
    if (!value || !sessionId) return;
    setScanInput('');
    setBusy(true);
    setErrorMsg(null);

    if (scanMode === 'invoice') {
      if (!accompaniesConfirmed) {
        setShowAccompanies(true);
      } else {
        await actuallyComplete(value);
      }
      setBusy(false);
      scanInputRef.current?.focus();
      return;
    }

    try {
      const res = await fetch('/api/inspect/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, scanValue: value, qty: 1 }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErrorMsg(j.message ?? `エラー: HTTP ${res.status}`);
        triggerFlash('red');
      } else {
        setLastResult(j.data);
        if (j.data.result === 'matched') {
          triggerFlash('green');
          await refreshOrder();
        } else if (j.data.result === 'already_done') {
          triggerFlash('blue');
        } else {
          triggerFlash('red');
        }
      }
    } finally {
      setBusy(false);
      scanInputRef.current?.focus();
    }
  }

  // 強制OK ボタン押下 → Sticky 有効時は即実行、無効時は ForceOkModal を起動
  async function onForceOk(item: InspectionItem) {
    if (!sessionId) return;
    if (sticky.active && sticky.reason) {
      await applyForceOk(item, sticky.reason);
      return;
    }
    setForceTarget(item);
  }

  async function applyForceOkFromModal(args: {
    code: string;
    reason: string;
    sticky: boolean;
  }) {
    if (!forceTarget || !sessionId) {
      setForceTarget(null);
      return;
    }
    const target = forceTarget;
    setForceTarget(null);
    if (args.sticky) sticky.activate(args.code as never, args.reason);
    else sticky.deactivate();
    await applyForceOk(target, args.reason);
  }

  async function applyForceOk(item: InspectionItem, reason: string) {
    setBusy(true);
    try {
      const res = await fetch('/api/inspect/force-ok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, itemId: item.id, reason }),
      });
      if (res.ok) await refreshOrder();
      else setErrorMsg((await res.json()).message ?? '強制OK失敗');
    } finally {
      setBusy(false);
      scanInputRef.current?.focus();
    }
  }

  // テンキー残数入力（A-16）: 商品コードを scanValue として一括加算
  async function applyManualQty(item: InspectionItem, addedQty: number) {
    if (!sessionId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/inspect/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          scanValue: item.productCode,
          qty: addedQty,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErrorMsg(j.message ?? '数量入力失敗');
        triggerFlash('red');
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      setLastResult(j.data);
      if (j.data.result === 'matched') {
        triggerFlash('green');
        await refreshOrder();
      } else if (j.data.result === 'over_scan') {
        triggerFlash('red');
        throw new Error('残数を超えています');
      } else if (j.data.result === 'already_done') {
        triggerFlash('blue');
      } else {
        triggerFlash('red');
      }
    } finally {
      setBusy(false);
      scanInputRef.current?.focus();
    }
  }

  async function onTogglePrintFlag() {
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(order.pkNo)}/print-flag`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_print_flag: !order.qrPrintFlag }),
      });
      if (res.ok) setOrder({ ...order, qrPrintFlag: !order.qrPrintFlag });
      else setErrorMsg((await res.json()).message ?? 'フラグ切替失敗');
    } finally {
      setBusy(false);
    }
  }

  async function actuallyComplete(invoiceValue?: string) {
    setBusy(true);
    setErrorMsg(null);
    const inv = invoiceValue ?? '';
    try {
      const res = await fetch('/api/inspect/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          pkNo: order.pkNo,
          invoiceNo: inv,
          ...(boxCode ? { boxCode } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErrorMsg(j.message ?? '完了処理失敗');
        return;
      }
      setCompleted(true);
      setCompletionInfo({
        durationSec: j.data.durationSec,
        qrPrintFlag: j.data.qrPrintFlag,
        print: j.data.print,
      });
    } finally {
      setBusy(false);
    }
  }

  // 保留メニューを開く（A-17）
  function onHold() {
    setHoldMenuOpen(true);
  }

  async function submitInspectionHold(reason = '現場保留') {
    if (!sessionId) {
      setHoldMenuOpen(false);
      return;
    }
    setBusy(true);
    setHoldMenuOpen(false);
    try {
      const res = await fetch('/api/inspect/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, reason }),
      });
      if (res.ok) router.push('/handy');
      else setErrorMsg((await res.json()).message ?? '保留失敗');
    } finally {
      setBusy(false);
    }
  }

  // 選択行を上下に移動（未完了行のみ対象）
  function moveSelectedRow(delta: 1 | -1) {
    const itemsArr = order.items;
    if (itemsArr.length === 0) return;
    const cur = selectedRow >= 0 ? selectedRow : 0;
    let next = cur;
    for (let i = 0; i < itemsArr.length; i++) {
      next = (next + delta + itemsArr.length) % itemsArr.length;
      // 完了済みでもナビは可能（モック準拠）
      break;
    }
    setSelectedRow(next);
  }

  // ハードキー Enter / Trigger: 選択行を +1 スキャン or 次の未完了をスキャン
  async function onTriggerScan() {
    if (!sessionId) return;
    const target =
      selectedRow >= 0
        ? selectedRow
        : order.items.findIndex(
            (it) => !it.forceOk && it.scannedQty < it.qty,
          );
    if (target < 0) return;
    const it = order.items[target];
    if (it.forceOk || it.scannedQty >= it.qty) return;
    setBusy(true);
    try {
      const res = await fetch('/api/inspect/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          scanValue: it.productCode,
          qty: 1,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErrorMsg(j.message ?? `エラー: HTTP ${res.status}`);
        triggerFlash('red');
      } else {
        setLastResult(j.data);
        if (j.data.result === 'matched') {
          triggerFlash('green');
          await refreshOrder();
        } else triggerFlash('red');
      }
    } finally {
      setBusy(false);
      scanInputRef.current?.focus();
    }
  }

  // F4 一括検品: 残全件を強制OK 扱いで完了させる（モック skipAndFinish 準拠）
  async function onBulkComplete() {
    if (!sessionId) return;
    if (!confirm('残り全ての商品を一括検品で完了させますか？（強制OK 相当）')) return;
    const targets = order.items.filter(
      (it) => !it.forceOk && it.scannedQty < it.qty,
    );
    setBusy(true);
    try {
      for (const it of targets) {
        await fetch('/api/inspect/force-ok', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            itemId: it.id,
            reason: 'F4 一括検品',
          }),
        });
      }
      await refreshOrder();
    } finally {
      setBusy(false);
    }
  }

  // ハードウェアキー（A-18）— モーダル開いてないときのみ反応
  useHardwareKeys({
    enabled: !anyModalOpen,
    onF1: () => {
      // 待機画面では連絡再表示のみ（idle 時は別画面なので通常ここには来ない）
      setShowNotices(true);
    },
    onF2: () => {
      // F2 = 強制OK（選択行 or 先頭の未完了行）
      const target =
        selectedRow >= 0
          ? order.items[selectedRow]
          : order.items.find((it) => !it.forceOk && it.scannedQty < it.qty);
      if (target) onForceOk(target);
    },
    onF3: () => {
      // F3 = 次の同梱物 toggle（同梱モーダルが開いていなければ何もしない）
      // 同梱物モーダルは AccompaniesModal 側で対応想定。ここでは noop。
    },
    onF4: () => {
      onBulkComplete();
    },
    onUp: () => moveSelectedRow(-1),
    onDown: () => moveSelectedRow(1),
    onTab: () => moveSelectedRow(1),
    onEnter: () => onTriggerScan(),
    onTrigger: () => onTriggerScan(),
    onEscape: () => {
      // 検品中の Esc は保留メニュー（モック準拠）
      setHoldMenuOpen(true);
    },
  });

  // 仮 boxCode（ハンディは選択 UI を出さず、API のおすすめを採用）
  useEffect(() => {
    fetch(`/api/master/boxes/suggest?pkNo=${encodeURIComponent(order.pkNo)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.data?.recommended?.code) setBoxCode(j.data.recommended.code);
      });
  }, [order.pkNo]);

  // === 完了画面 ===
  if (completed) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-emerald-900 to-emerald-800 flex items-center justify-center p-4 text-ink-strong">
        <div className="text-center">
          <div className="text-7xl mb-3 animate-pulse">✅</div>
          <h1 className="text-2xl font-bold mb-1">梱包完了</h1>
          <p className="text-emerald-100 mb-4 text-xs font-mono">{order.pkNo}</p>
          <dl className="bg-emerald-950/40 border border-emerald-700/40 rounded-lg p-3 grid grid-cols-2 gap-2 text-2xs max-w-xs mx-auto mb-4">
            <dt className="text-emerald-300">所要時間</dt>
            <dd className="text-right font-mono tabular-nums">
              {completionInfo?.durationSec ?? '—'} 秒
            </dd>
            <dt className="text-emerald-300">QR印刷</dt>
            <dd className="text-right">
              {completionInfo?.qrPrintFlag ? 'ON' : 'OFF'}
              {completionInfo?.print &&
                ` / ${completionInfo.print.ok ? '送信' : '失敗'}${completionInfo.print.dryRun ? '*' : ''}`}
            </dd>
          </dl>
          <button
            onClick={() => router.push('/handy')}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold border border-blue-400"
          >
            次の伝票へ (Enter)
          </button>
        </div>
      </main>
    );
  }

  // === メイン画面 ===
  const totalQty = order.items.reduce((s, i) => s + i.qty, 0);
  const scannedQty = order.items.reduce(
    (s, i) => s + (i.forceOk ? i.qty : i.scannedQty),
    0,
  );

  const flashCls =
    flash === 'green'
      ? 'bg-emerald-500/30'
      : flash === 'red'
        ? 'bg-red-500/40 animate-pulse'
        : flash === 'blue'
          ? 'bg-blue-500/30'
          : '';

  return (
    <main className="h-screen bg-surface-base text-ink overflow-hidden flex flex-col max-w-md mx-auto">
      {/* フラッシュ */}
      {flash && (
        <div
          className={cn(
            'fixed inset-0 z-[60] pointer-events-none transition-opacity duration-300',
            flashCls,
          )}
        />
      )}

      {/* モーダル */}
      {showNotices && (
        <NoticesModal variant="handy-launch" onClose={() => setShowNotices(false)} />
      )}
      {showNoshi && (
        <NoshiConfirmationModal
          pkNo={order.pkNo}
          noshiName={order.noshiName}
          qrPrintFlag={order.qrPrintFlag}
          onConfirm={() => setShowNoshi(false)}
          onCancel={() => router.push('/handy')}
        />
      )}
      {showAccompanies && (
        <AccompaniesModal
          pkNo={order.pkNo}
          onConfirm={() => {
            setAccompaniesConfirmed(true);
            setShowAccompanies(false);
            actuallyComplete();
          }}
          onCancel={() => setShowAccompanies(false)}
        />
      )}
      <ForceOkModal
        open={forceTarget !== null}
        productName={forceTarget?.productName}
        vertical
        onConfirm={applyForceOkFromModal}
        onCancel={() => setForceTarget(null)}
      />
      <QtyKeypadModal
        open={qtyTarget !== null}
        productName={qtyTarget?.productName ?? ''}
        productCode={qtyTarget?.productCode ?? ''}
        productJan={qtyTarget?.productJan ?? null}
        alreadyScanned={qtyTarget?.scannedQty ?? 0}
        totalQty={qtyTarget?.qty ?? 0}
        onConfirm={async (n) => {
          if (qtyTarget) await applyManualQty(qtyTarget, n);
          setQtyTarget(null);
        }}
        onCancel={() => setQtyTarget(null)}
      />
      <HoldMenuModal
        open={holdMenuOpen}
        onSelectInspectionHold={() => submitInspectionHold()}
        onSelectContact={() => {
          setHoldMenuOpen(false);
          setHoldContactOpen(true);
        }}
        onCancel={() => setHoldMenuOpen(false)}
      />
      <HoldContactModal
        open={holdContactOpen}
        pkNo={order.pkNo}
        staffCode={employee?.staffCode}
        onSent={() => setHoldContactOpen(false)}
        onCancel={() => setHoldContactOpen(false)}
      />
      <ReprintModal open={reprintOpen} onClose={() => setReprintOpen(false)} />

      {/* Sticky 強制検品中バナー */}
      {sticky.active && (
        <div className="bg-status-warn text-black px-2 py-1 flex items-center justify-between gap-2 z-40 border-b border-amber-700">
          <span className="text-2xs font-bold leading-tight">
            ⚠ 強制検品中 / <span className="font-mono">{sticky.code}</span>
          </span>
          <button
            onClick={sticky.deactivate}
            className="px-1.5 py-0.5 rounded bg-black/30 text-2xs font-bold border border-black/40"
          >
            解除
          </button>
        </div>
      )}

      {/* ヘッダ（薄め） */}
      <header className="bg-surface-panel border-b border-surface-border h-9 flex items-center px-2 gap-2 shrink-0">
        <span className="text-2xs font-bold text-ink-strong">ハンディ検品</span>
        <span className="text-3xs text-ink-muted">{employee?.deviceCode}</span>
        <div className="flex-1" />
        <button
          onClick={() => router.push('/handy')}
          className="text-3xs text-ink-subtle hover:text-status-error"
          title="中断"
        >
          ⏻
        </button>
      </header>

      {/* PkNo + 配送先 */}
      <div className="bg-surface-panel border-b border-surface-border px-2 py-1.5 shrink-0">
        <div className="flex items-baseline justify-between">
          <span className="text-3xs text-ink-subtle uppercase">PkNo</span>
          <span className="text-sm font-mono font-bold text-accent-amber tabular-nums">
            {order.pkNo}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5 text-3xs text-ink-muted">
          <span className="truncate">{order.destName ?? '—'}</span>
          <span className="shrink-0 ml-2">{order.carrier?.short ?? order.carrier?.name}</span>
        </div>
      </div>

      {/* 進捗 + フラグ */}
      <div className="bg-surface-base px-2 py-2 border-b border-surface-border flex items-center gap-2 shrink-0">
        <div className="flex-1">
          <div className="text-3xs text-ink-subtle uppercase">進捗</div>
          <div className="text-2xl font-bold text-accent-amber tabular-nums font-mono leading-none">
            {scannedQty}<span className="text-ink-muted text-sm">/{totalQty}</span>
            <span className="text-2xs text-ink-muted ml-1 font-sans">点</span>
          </div>
        </div>
        <button
          onClick={onTogglePrintFlag}
          disabled={busy}
          className={cn(
            'px-2 py-1.5 rounded border-2 text-2xs font-bold flex flex-col items-center gap-0.5',
            order.qrPrintFlag
              ? 'border-pink-600 bg-pink-950/40 text-pink-300'
              : 'border-surface-border bg-surface-panel text-ink-muted',
          )}
        >
          <span>🖨 QR印刷</span>
          <span className={order.qrPrintFlag ? 'text-pink-200' : ''}>
            {order.qrPrintFlag ? 'ON' : 'OFF'}
          </span>
        </button>
      </div>

      {/* 商品リスト */}
      <div className="flex-1 overflow-auto px-1.5 py-1.5 space-y-1">
        {order.items.map((it, idx) => (
          <ScanLine
            key={it.id}
            item={it}
            isLast={lastResult?.itemId === it.id}
            lastResult={lastResult}
            onForceOk={onForceOk}
            onOpenKeypad={(item) => setQtyTarget(item)}
            isSelected={selectedRow === idx}
          />
        ))}
        {order.items.length === 0 && (
          <p className="text-center text-ink-muted text-2xs py-4">商品がありません</p>
        )}
      </div>

      {/* スキャン結果バナー / エラー */}
      {(lastResult || errorMsg) && (
        <div className="px-2 py-1 border-t border-surface-border bg-surface-panel shrink-0">
          {errorMsg && <div className="text-2xs text-status-error">⚠ {errorMsg}</div>}
          {!errorMsg && lastResult && <ScanResultBanner result={lastResult.result} />}
        </div>
      )}

      {/* スキャン入力 */}
      <form
        onSubmit={onScan}
        className={cn(
          'p-2 border-t-2 shrink-0',
          allInspected
            ? 'bg-cyan-950/40 border-t-cyan-500'
            : 'bg-surface-panel border-t-surface-border',
        )}
      >
        <label
          className={cn(
            'block text-3xs font-bold uppercase tracking-wider mb-1',
            allInspected ? 'text-cyan-300 animate-pulse' : 'text-accent-amber',
          )}
        >
          {allInspected ? '👉 納品書№ をスキャン' : '商品 JAN/コード をスキャン'}
        </label>
        <input
          ref={scanInputRef}
          autoFocus
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          className={cn(
            'w-full bg-surface-base border-2 rounded px-2 py-2 text-base font-mono text-ink-strong tabular-nums focus:outline-none',
            allInspected
              ? 'border-cyan-500 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-500/30'
              : 'border-accent-amber/50 focus:border-accent-amber focus:ring-2 focus:ring-accent-amber/30',
          )}
          placeholder={allInspected ? '00012345670001' : '4901234567894'}
        />
      </form>

      {/* フッタ操作（小さめのボタン2つ） */}
      <footer className="bg-surface-panel border-t border-surface-border h-10 grid grid-cols-2 gap-1 p-1 shrink-0">
        <button
          onClick={onHold}
          disabled={busy}
          className="bg-red-700 hover:bg-red-600 text-white rounded border border-red-500 text-2xs font-bold disabled:opacity-50"
        >
          🚧 保留
        </button>
        <button
          onClick={() => router.push('/handy')}
          disabled={busy}
          className="bg-slate-700 hover:bg-slate-600 text-white rounded border border-slate-500 text-2xs font-bold disabled:opacity-50"
        >
          ⏻ 中断
        </button>
      </footer>
    </main>
  );
}

function ScanLine({
  item,
  isLast,
  lastResult,
  onForceOk,
  onOpenKeypad,
  isSelected,
}: {
  item: InspectionItem;
  isLast: boolean;
  lastResult: { result: ScanResult; itemId: number | null } | null;
  onForceOk: (i: InspectionItem) => void;
  onOpenKeypad: (i: InspectionItem) => void;
  isSelected?: boolean;
}) {
  const done = item.forceOk || item.scannedQty >= item.qty;
  const warn = isLast && lastResult?.result === 'over_scan';

  return (
    <div
      className={cn(
        'grid items-center gap-1.5 px-1.5 py-1 rounded border-l-4',
        warn
          ? 'border-l-status-error bg-red-950/40 animate-shake'
          : done
            ? 'border-l-status-ok bg-emerald-950/40'
            : 'border-l-surface-border-strong bg-surface-panel',
        isSelected && 'ring-2 ring-accent-amber',
      )}
      style={{ gridTemplateColumns: '24px 1fr 56px 44px' }}
    >
      <div
        className={cn(
          'w-5 h-5 rounded flex items-center justify-center text-3xs font-bold',
          done ? 'bg-status-ok text-white' : 'bg-surface-raised text-ink-muted',
        )}
      >
        {done ? '✓' : '○'}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 truncate">
          <span className="text-xs font-bold text-ink-strong truncate">
            {item.productName}
          </span>
          {item.productFrozen && (
            <span className="text-3xs bg-frozen-bg text-frozen-light px-1 rounded">
              冷
            </span>
          )}
          {item.forceOk && (
            <span className="text-3xs bg-status-warn-bg text-accent-amber px-1 rounded">
              強
            </span>
          )}
        </div>
        <div className="text-3xs text-ink-muted font-mono truncate leading-tight">
          {item.productJan ?? item.productCode}
        </div>
      </div>
      <div className="text-right">
        {done ? (
          <div className="text-sm font-bold tabular-nums font-mono text-status-ok">
            {item.scannedQty}
            <span className="text-ink-muted text-2xs">/{item.qty}</span>
          </div>
        ) : (
          <button
            onClick={() => onOpenKeypad(item)}
            className="text-sm font-bold tabular-nums font-mono text-ink-strong hover:text-accent-amber"
            title="数量入力"
          >
            {item.scannedQty}
            <span className="text-ink-muted text-2xs">/{item.qty}</span>
          </button>
        )}
      </div>
      <div className="text-right">
        {!done && (
          <button
            onClick={() => onForceOk(item)}
            className="text-3xs text-status-warn hover:underline font-bold"
          >
            強制
          </button>
        )}
      </div>
    </div>
  );
}

function ScanResultBanner({ result }: { result: ScanResult }) {
  const map: Record<ScanResult, { text: string; cls: string }> = {
    matched: { text: '✓ MATCHED', cls: 'text-status-ok' },
    over_scan: { text: '⚠ OVER SCAN', cls: 'text-status-error' },
    not_found: { text: '✗ NOT FOUND', cls: 'text-status-error' },
    already_done: { text: 'ℹ ALREADY DONE', cls: 'text-status-info' },
  };
  const m = map[result];
  return <div className={cn('text-2xs font-bold', m.cls)}>{m.text}</div>;
}
