'use client';

/**
 * タブレット検品画面（モック準拠 / Phase 7-3）
 *
 * 横向き: 3 ペイン（左 320px / 中央 / 右 280px）+ フッタ 6 ボタン
 * 縦向き: 縦積み（左ペイン → 中央 → 右ペイン）+ フッタ 2 行 3 列
 *
 * スキャン入力は外付スキャナ（HID）想定の不可視 input にフォーカス継続。
 * matched/over/not_found 等の結果は全画面フラッシュ + 行ハイライトで通知。
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { NoticesModal } from '@/components/inspection/notices-modal';
import { NoshiConfirmationModal } from '@/components/inspection/noshi-confirmation-modal';
import { AccompaniesModal } from '@/components/inspection/accompanies-modal';
import { BoxSuggestion } from '@/components/inspection/box-suggestion';
import { ForceOkModal } from '@/components/inspection/force-ok-modal';
import { QtyKeypadModal } from '@/components/inspection/qty-keypad-modal';
import { HoldMenuModal } from '@/components/inspection/hold-menu-modal';
import { HoldContactModal } from '@/components/inspection/hold-contact-modal';
import { useStickyForceOk } from '@/lib/use-sticky-force-ok';

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

const FLOW_STEPS = ['ピッキング№', '商品検品', '納品書№'] as const;

export function TabletInspectionScreen({ order: initialOrder, employee }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState(initialOrder);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [boxCode, setBoxCode] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ result: ScanResult; itemId: number | null } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [completionInfo, setCompletionInfo] = useState<{
    durationSec: number;
    qrPrintFlag: boolean;
    print: { ok: boolean; dryRun: boolean } | null;
  } | null>(null);

  // 縦/横レイアウト（既定: 横）
  const [portrait, setPortrait] = useState(false);

  // フラッシュアニメ
  const [flash, setFlash] = useState<FlashColor>(null);

  // 入力モード（'product' = 商品スキャン / 'invoice' = 納品書スキャン）
  const [scanMode, setScanMode] = useState<'product' | 'invoice'>('product');

  // モーダル制御
  const [showNotices, setShowNotices] = useState(true);
  const [showNoshi, setShowNoshi] = useState(false);
  const [showAccompanies, setShowAccompanies] = useState(false);
  const [accompaniesConfirmed, setAccompaniesConfirmed] = useState(false);
  const [forceTarget, setForceTarget] = useState<InspectionItem | null>(null);
  const [qtyTarget, setQtyTarget] = useState<InspectionItem | null>(null);
  const [holdMenuOpen, setHoldMenuOpen] = useState(false);
  const [holdContactOpen, setHoldContactOpen] = useState(false);

  // Sticky 強制検品モード（A-15）
  const sticky = useStickyForceOk();

  const scanInputRef = useRef<HTMLInputElement>(null);

  const allInspected = order.items.every((it) => it.forceOk || it.scannedQty >= it.qty);

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

  // モーダルが閉じたら入力フォーカス回復
  useEffect(() => {
    if (!showNotices && !showNoshi && !showAccompanies) {
      scanInputRef.current?.focus();
    }
  }, [showNotices, showNoshi, showAccompanies]);

  // 全件完了したら自動で納品書モードに
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
      // 納品書スキャン → 同梱物未確認なら先にモーダル
      setInvoiceNo(value);
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

  // 強制OK ボタン押下: Sticky 有効時はモーダルを出さず即実行、無効時は理由選択
  async function onForceOk(item: InspectionItem) {
    if (!sessionId) return;
    if (sticky.active && sticky.reason) {
      await applyForceOk(item, sticky.reason);
      return;
    }
    setForceTarget(item);
  }

  // モーダル確定時: API 呼出 + Sticky 化（任意）
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
    if (args.sticky) {
      sticky.activate(args.code as never, args.reason);
    } else {
      sticky.deactivate();
    }
    await applyForceOk(target, args.reason);
  }

  async function applyForceOk(item: InspectionItem, reason: string) {
    setBusy(true);
    setErrorMsg(null);
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
    setErrorMsg(null);
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
    const inv = invoiceValue ?? invoiceNo;
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

  // F5 / フッタ「中断」: 保留メニューを開く（A-17）
  function onHold() {
    setHoldMenuOpen(true);
  }

  // 保留メニュー → 検品保留 (デフォルト理由は「現場保留」)
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
      if (res.ok) router.push('/tablet');
      else setErrorMsg((await res.json()).message ?? '保留失敗');
    } finally {
      setBusy(false);
    }
  }

  // === 完了画面 ===
  if (completed) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-emerald-900 to-emerald-800 flex items-center justify-center p-6 text-ink-strong">
        <div className="text-center">
          <div className="text-9xl mb-4 animate-pulse">✅</div>
          <h1 className="text-4xl font-bold mb-2">梱包完了</h1>
          <p className="text-emerald-100 mb-8 font-mono">{order.pkNo}</p>
          <dl className="bg-emerald-950/40 border border-emerald-700/40 rounded-xl p-5 grid grid-cols-2 gap-3 text-sm max-w-md mx-auto mb-8">
            <dt className="text-emerald-300">所要時間</dt>
            <dd className="text-right font-mono tabular-nums">{completionInfo?.durationSec ?? '—'} 秒</dd>
            <dt className="text-emerald-300">QR印刷フラグ</dt>
            <dd className="text-right">{completionInfo?.qrPrintFlag ? 'ON' : 'OFF'}</dd>
            <dt className="text-emerald-300">印刷</dt>
            <dd className="text-right">
              {completionInfo?.print
                ? `${completionInfo.print.ok ? '送信済' : '失敗'}${completionInfo.print.dryRun ? '（DRY-RUN）' : ''}`
                : '—'}
            </dd>
          </dl>
          <button
            onClick={() => router.push('/tablet')}
            className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-lg font-bold border border-blue-400"
          >
            次の伝票へ
          </button>
        </div>
      </main>
    );
  }

  // === メイン画面 ===
  const flashCls =
    flash === 'green'
      ? 'bg-emerald-500/25'
      : flash === 'red'
        ? 'bg-red-500/35 animate-pulse'
        : flash === 'blue'
          ? 'bg-blue-500/35'
          : '';

  return (
    <main className="h-screen bg-surface-base text-ink overflow-hidden flex flex-col">
      {/* フラッシュオーバーレイ */}
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
        <NoticesModal variant="tablet-launch" onClose={() => setShowNotices(false)} />
      )}
      {showNoshi && (
        <NoshiConfirmationModal
          pkNo={order.pkNo}
          noshiName={order.noshiName}
          qrPrintFlag={order.qrPrintFlag}
          onConfirm={() => setShowNoshi(false)}
          onCancel={() => router.push('/tablet')}
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
          if (qtyTarget) {
            await applyManualQty(qtyTarget, n);
          }
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
        onSent={() => {
          setHoldContactOpen(false);
          // 連絡送信後はそのまま検品継続（保留しない）
        }}
        onCancel={() => setHoldContactOpen(false)}
      />

      {/* Sticky 強制検品中バナー（A-15） */}
      {sticky.active && (
        <div className="bg-status-warn text-black px-3 py-1.5 flex items-center justify-between gap-3 z-40 border-b border-amber-700">
          <span className="text-xs font-bold">
            ⚠ 強制検品中 ／ 理由コード: <span className="font-mono">{sticky.code}</span>
            <span className="font-normal ml-2 opacity-80">
              次以降の強制OK ボタンも自動でこの理由で実行されます
            </span>
          </span>
          <button
            onClick={sticky.deactivate}
            className="px-2.5 py-0.5 rounded bg-black/30 hover:bg-black/50 text-xs font-bold border border-black/40"
          >
            解除
          </button>
        </div>
      )}

      {/* 不可視スキャン入力（外付スキャナ前提） */}
      <form onSubmit={onScan} className="absolute -top-px left-0">
        <input
          ref={scanInputRef}
          autoFocus
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          className="opacity-0 w-1 h-1"
          aria-label="バーコードスキャナ入力"
          inputMode="none"
        />
      </form>

      {/* ヘッダ */}
      <Header
        order={order}
        employee={employee}
        portrait={portrait}
        onTogglePortrait={() => setPortrait((p) => !p)}
        onExit={() => router.push('/tablet')}
      />

      {/* 本体 */}
      <div
        className={cn(
          'flex-1 min-h-0 grid gap-1.5 p-1.5',
          portrait
            ? 'grid-rows-[auto_1fr_auto]'
            : 'grid-cols-[320px_1fr_280px]',
        )}
      >
        <LeftPane
          order={order}
          onTogglePrintFlag={onTogglePrintFlag}
          boxCode={boxCode}
          onSelectBox={setBoxCode}
          busy={busy}
          portrait={portrait}
        />
        <CenterPane
          items={order.items}
          scanMode={scanMode}
          lastResult={lastResult}
          errorMsg={errorMsg}
          allInspected={allInspected}
          onForceOk={onForceOk}
          onOpenKeypad={(it) => setQtyTarget(it)}
        />
        {!portrait && (
          <RightPane
            destName={order.destName}
            destZip={order.destZip}
            destAddr={order.destAddr}
            noshiName={order.noshiName}
            pkNo={order.pkNo}
          />
        )}
      </div>

      {/* フッタ */}
      <Footer
        scanMode={scanMode}
        allInspected={allInspected}
        onHold={onHold}
        onExit={() => router.push('/tablet')}
        busy={busy}
      />
    </main>
  );
}

/* ====== ヘッダ ====== */
function Header({
  order,
  employee,
  portrait,
  onTogglePortrait,
  onExit,
}: {
  order: InspectionOrder;
  employee: Props['employee'];
  portrait: boolean;
  onTogglePortrait: () => void;
  onExit: () => void;
}) {
  return (
    <header className="bg-surface-panel border-b border-surface-border h-12 flex items-center px-3 gap-3 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-base font-bold text-ink-strong">タブレット検品</span>
        <span className="text-3xs text-ink-muted">v0.18</span>
      </div>
      <div className="flex items-center gap-2 px-2 py-1 bg-surface-base rounded border border-surface-border">
        <span className="text-3xs text-ink-subtle">PkNo</span>
        <span className="text-sm font-mono font-bold text-accent-amber tabular-nums">
          {order.pkNo}
        </span>
        <span className="text-3xs text-ink-muted">
          / {order.carrier?.short ?? order.carrier?.name ?? '—'}
        </span>
      </div>
      <div className="flex-1" />
      <button
        onClick={onTogglePortrait}
        className="text-2xs text-ink-subtle hover:text-accent-amber px-2 py-1 rounded border border-surface-border bg-surface-base"
        title="縦横切替"
      >
        {portrait ? '◫ 横' : '▯ 縦'}
      </button>
      {employee && (
        <div className="flex items-center gap-1.5 text-2xs text-ink-subtle px-2 py-1 bg-surface-base rounded border border-surface-border">
          <span className="w-5 h-5 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center text-3xs font-bold">
            {employee.name[0]}
          </span>
          <span>{employee.name}</span>
          <span className="text-ink-muted">/ {employee.deviceCode}</span>
        </div>
      )}
      <button
        onClick={onExit}
        className="text-2xs text-ink-subtle hover:text-status-error"
        title="検品を中断"
      >
        ⏻
      </button>
    </header>
  );
}

/* ====== 左ペイン ====== */
function LeftPane({
  order,
  onTogglePrintFlag,
  boxCode,
  onSelectBox,
  busy,
  portrait,
}: {
  order: InspectionOrder;
  onTogglePrintFlag: () => void;
  boxCode: string | null;
  onSelectBox: (c: string | null) => void;
  busy: boolean;
  portrait: boolean;
}) {
  return (
    <div
      className={cn(
        'bg-surface-panel border border-surface-border rounded-md p-2.5 space-y-2 overflow-auto',
        portrait && 'flex gap-2 space-y-0 overflow-x-auto items-center',
      )}
    >
      <Field label="出荷予定" value={order.status} portrait={portrait} />
      <Field label="納品書№" mono value={order.invoiceNo ?? '—'} portrait={portrait} />

      {/* 印刷フラグ */}
      <div
        className={cn(
          'rounded border-2 p-2 cursor-pointer transition-colors flex flex-col gap-0.5',
          order.qrPrintFlag
            ? 'border-pink-600 bg-pink-950/40'
            : 'border-surface-border bg-surface-base',
          portrait && 'shrink-0 min-w-[140px]',
        )}
        onClick={() => !busy && onTogglePrintFlag()}
      >
        <div className="text-3xs text-ink-subtle uppercase">QR印刷フラグ</div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'w-4 h-4 rounded border-2 flex items-center justify-center text-3xs',
              order.qrPrintFlag
                ? 'bg-pink-600 border-pink-600 text-white'
                : 'border-surface-border-strong',
            )}
          >
            {order.qrPrintFlag && '✓'}
          </span>
          <span
            className={cn(
              'text-xs font-bold',
              order.qrPrintFlag ? 'text-pink-300' : 'text-ink-muted',
            )}
          >
            {order.qrPrintFlag ? 'ON 自動印刷' : 'OFF 印刷しない'}
          </span>
        </div>
      </div>

      {/* 推奨箱 */}
      {!portrait && (
        <div className="bg-surface-base border border-surface-border rounded p-2">
          <BoxSuggestion
            pkNo={order.pkNo}
            selectedBoxCode={boxCode}
            onSelect={onSelectBox}
            density="compact"
          />
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  portrait,
}: {
  label: string;
  value: string;
  mono?: boolean;
  portrait?: boolean;
}) {
  return (
    <div
      className={cn(
        'bg-surface-base border border-surface-border rounded p-1.5',
        portrait && 'shrink-0 min-w-[120px]',
      )}
    >
      <div className="text-3xs text-ink-subtle uppercase">{label}</div>
      <div className={cn('text-sm font-bold text-ink-strong', mono && 'font-mono tabular-nums')}>
        {value}
      </div>
    </div>
  );
}

/* ====== 中央ペイン ====== */
function CenterPane({
  items,
  scanMode,
  lastResult,
  errorMsg,
  allInspected,
  onForceOk,
  onOpenKeypad,
}: {
  items: InspectionItem[];
  scanMode: 'product' | 'invoice';
  lastResult: { result: ScanResult; itemId: number | null } | null;
  errorMsg: string | null;
  allInspected: boolean;
  onForceOk: (item: InspectionItem) => void;
  onOpenKeypad: (item: InspectionItem) => void;
}) {
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const scannedQty = items.reduce((s, i) => s + (i.forceOk ? i.qty : i.scannedQty), 0);

  return (
    <div className="bg-surface-panel border border-surface-border rounded-md flex flex-col overflow-hidden">
      {/* ヘッダ: 進捗チップ + フローステップ */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border">
        <div className="flex items-center gap-3">
          <div className="text-3xs text-ink-subtle uppercase">進捗</div>
          <div className="text-xl font-bold text-accent-amber tabular-nums font-mono">
            {scannedQty} / {totalQty}
            <span className="text-2xs text-ink-muted ml-1 font-sans">点</span>
          </div>
        </div>
        <FlowSteps currentStep={scanMode === 'invoice' ? 2 : 1} />
      </div>

      {/* スキャンライン */}
      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        {items.map((it) => (
          <ScanLine
            key={it.id}
            item={it}
            isLast={lastResult?.itemId === it.id}
            lastResult={lastResult}
            onForceOk={onForceOk}
            onOpenKeypad={onOpenKeypad}
          />
        ))}
      </div>

      {/* 直近スキャン結果 / エラー */}
      {(lastResult || errorMsg) && (
        <div className="px-3 py-1.5 border-t border-surface-border">
          {errorMsg && <div className="text-xs text-status-error">⚠ {errorMsg}</div>}
          {!errorMsg && lastResult && <ScanResultBanner result={lastResult.result} />}
        </div>
      )}

      {/* 完了入力プロンプト */}
      {allInspected && (
        <div className="px-3 py-2 border-t border-surface-border bg-cyan-950/40">
          <div className="text-xs font-bold text-cyan-300 animate-pulse">
            👉 納品書№ をスキャンして完了
          </div>
        </div>
      )}
    </div>
  );
}

function FlowSteps({ currentStep }: { currentStep: 0 | 1 | 2 }) {
  return (
    <div className="flex items-center gap-1">
      {FLOW_STEPS.map((label, idx) => {
        const done = idx < currentStep;
        const active = idx === currentStep;
        return (
          <div key={label} className="flex items-center">
            <div
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded-full text-3xs font-bold',
                done
                  ? 'bg-status-ok-bg text-status-ok'
                  : active
                    ? 'bg-status-warn-bg text-accent-amber animate-pulse'
                    : 'bg-surface-raised text-ink-muted',
              )}
            >
              <span>{idx + 1}</span>
              <span>{label}</span>
            </div>
            {idx < FLOW_STEPS.length - 1 && (
              <div className="w-2 h-px bg-surface-border-strong mx-0.5" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScanLine({
  item,
  isLast,
  lastResult,
  onForceOk,
  onOpenKeypad,
}: {
  item: InspectionItem;
  isLast: boolean;
  lastResult: { result: ScanResult; itemId: number | null } | null;
  onForceOk: (i: InspectionItem) => void;
  onOpenKeypad: (i: InspectionItem) => void;
}) {
  const done = item.forceOk || item.scannedQty >= item.qty;
  const warn = isLast && lastResult?.result === 'over_scan';

  return (
    <div
      className={cn(
        'grid items-center gap-2 px-2 py-1.5 rounded border-l-4 transition-all',
        warn
          ? 'border-l-status-error bg-red-950/40 animate-shake'
          : done
            ? 'border-l-status-ok bg-emerald-950/40'
            : 'border-l-surface-border-strong bg-surface-base',
      )}
      style={{ gridTemplateColumns: '32px 1fr 100px 88px' }}
    >
      <div
        className={cn(
          'w-7 h-7 rounded flex items-center justify-center text-sm font-bold',
          done
            ? 'bg-status-ok text-white'
            : 'bg-surface-raised text-ink-muted',
        )}
      >
        {done ? '✓' : '○'}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 truncate">
          <span className="text-sm font-bold text-ink-strong truncate">
            {item.productName}
          </span>
          {item.productFrozen && (
            <span className="text-3xs bg-frozen-bg text-frozen-light px-1 rounded font-bold">
              冷凍
            </span>
          )}
          {item.forceOk && (
            <span className="text-3xs bg-status-warn-bg text-accent-amber px-1 rounded font-bold">
              強制
            </span>
          )}
        </div>
        <div className="text-3xs text-ink-muted font-mono truncate">
          {item.productCode}
          {item.productJan && ` / ${item.productJan}`}
        </div>
      </div>
      <div className="text-right">
        {done ? (
          <div className="text-base font-bold tabular-nums font-mono text-status-ok">
            {item.scannedQty}
            <span className="text-ink-muted text-xs"> / {item.qty}</span>
          </div>
        ) : (
          <button
            onClick={() => onOpenKeypad(item)}
            title="数量入力（残数を加算）"
            className="text-base font-bold tabular-nums font-mono text-ink-strong hover:text-accent-amber underline-offset-2 hover:underline"
          >
            {item.scannedQty}
            <span className="text-ink-muted text-xs"> / {item.qty}</span>
            <span className="ml-1 text-3xs text-ink-muted">🔢</span>
          </button>
        )}
      </div>
      <div className="text-right">
        {!done && (
          <button
            onClick={() => onForceOk(item)}
            className="text-3xs text-status-warn hover:underline font-bold"
          >
            強制OK
          </button>
        )}
      </div>
    </div>
  );
}

function ScanResultBanner({ result }: { result: ScanResult }) {
  const map: Record<ScanResult, { text: string; cls: string }> = {
    matched: { text: '✓ MATCHED', cls: 'text-status-ok' },
    over_scan: { text: '⚠ OVER SCAN（数量超過）', cls: 'text-status-error' },
    not_found: { text: '✗ NOT FOUND（マスタ未登録）', cls: 'text-status-error' },
    already_done: { text: 'ℹ ALREADY DONE', cls: 'text-status-info' },
  };
  const m = map[result];
  return <div className={cn('text-xs font-bold', m.cls)}>{m.text}</div>;
}

/* ====== 右ペイン ====== */
function RightPane({
  destName,
  destZip,
  destAddr,
  noshiName,
  pkNo,
}: {
  destName: string | null;
  destZip: string | null;
  destAddr: string | null;
  noshiName: string | null;
  pkNo: string;
}) {
  return (
    <div className="bg-surface-panel border border-surface-border rounded-md p-2.5 space-y-2 overflow-auto">
      <div>
        <div className="text-3xs text-accent-amber font-bold uppercase tracking-wider mb-1">
          📍 お届け先
        </div>
        <div className="bg-surface-base border border-surface-border rounded p-2 text-xs space-y-0.5">
          <div className="font-bold text-ink-strong">{destName ?? '—'}</div>
          <div className="text-ink-subtle font-mono tabular-nums">{destZip ?? ''}</div>
          <div className="text-ink-subtle text-2xs">{destAddr ?? ''}</div>
        </div>
      </div>
      {noshiName && (
        <div>
          <div className="text-3xs text-pink-300 font-bold uppercase tracking-wider mb-1">
            🎀 のし
          </div>
          <div className="bg-pink-950/40 border border-pink-700/40 rounded p-2 text-xs">
            <div className="text-pink-200 font-bold">{noshiName}</div>
          </div>
        </div>
      )}
      <div>
        <div className="text-3xs text-ink-subtle uppercase tracking-wider mb-1">
          🔗 関連 PkNo
        </div>
        <div className="bg-surface-base border border-surface-border rounded p-2 text-2xs font-mono text-ink-muted">
          {pkNo}
        </div>
      </div>
    </div>
  );
}

/* ====== フッタ ====== */
function Footer({
  scanMode,
  allInspected,
  onHold,
  onExit,
  busy,
}: {
  scanMode: 'product' | 'invoice';
  allInspected: boolean;
  onHold: () => void;
  onExit: () => void;
  busy: boolean;
}) {
  return (
    <footer className="bg-surface-panel border-t border-surface-border h-16 grid grid-cols-6 gap-1 p-1 shrink-0">
      <FooterButton
        label={scanMode === 'invoice' ? '納品書スキャン' : '商品スキャン'}
        sublabel="F1"
        emphasize={allInspected}
        cls={
          allInspected
            ? 'bg-cyan-700 hover:bg-cyan-600 border-cyan-400 animate-pulse'
            : 'bg-blue-700 hover:bg-blue-600 border-blue-500'
        }
        disabled={busy}
      />
      <FooterButton
        label="強制OK"
        sublabel="F2"
        cls="bg-orange-700 hover:bg-orange-600 border-orange-500"
        disabled={busy}
      />
      <FooterButton
        label="同梱物 ON"
        sublabel="F3"
        cls="bg-slate-700 hover:bg-slate-600 border-slate-500"
        disabled={busy}
      />
      <FooterButton
        label="一括検品"
        sublabel="F4"
        cls="bg-emerald-700 hover:bg-emerald-600 border-emerald-500"
        disabled={busy}
      />
      <FooterButton
        label="伝票保留"
        sublabel="F5"
        cls="bg-red-700 hover:bg-red-600 border-red-500"
        onClick={onHold}
        disabled={busy}
      />
      <FooterButton
        label="中断"
        sublabel="ESC"
        cls="bg-slate-700 hover:bg-slate-600 border-slate-500"
        onClick={onExit}
        disabled={busy}
      />
    </footer>
  );
}

function FooterButton({
  label,
  sublabel,
  cls,
  onClick,
  disabled,
  emphasize,
}: {
  label: string;
  sublabel: string;
  cls: string;
  onClick?: () => void;
  disabled?: boolean;
  emphasize?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded border-2 text-white flex flex-col items-center justify-center transition-all',
        'active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
        cls,
      )}
    >
      <span className={cn('text-sm font-bold', emphasize && 'text-base')}>{label}</span>
      <span className="text-3xs opacity-70">{sublabel}</span>
    </button>
  );
}
