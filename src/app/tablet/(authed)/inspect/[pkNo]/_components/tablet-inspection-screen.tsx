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
import { BoxSuggestion } from '@/components/inspection/box-suggestion';
import { FinalCheckModal } from '@/components/inspection/final-check-modal';
import { ForceOkModal } from '@/components/inspection/force-ok-modal';
import { QtyKeypadModal } from '@/components/inspection/qty-keypad-modal';
import { HoldMenuModal } from '@/components/inspection/hold-menu-modal';
import { HoldContactModal } from '@/components/inspection/hold-contact-modal';
import { PrintConfirmModal } from '@/components/inspection/print-confirm-modal';
import { useStickyForceOk } from '@/lib/use-sticky-force-ok';
import { useScanSound } from '@/lib/use-scan-sound';
import { SoundToggle } from '@/components/inspection/sound-toggle';
import {
  BarcodeIcon,
  ShieldCheckIcon,
  BoxIcon,
  ClipboardCheckIcon,
  BookmarkIcon,
  ArrowLeftIcon,
} from '@/components/inspection/tablet-icons';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';

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
  customerCode: string | null;
  orderNo: string | null;
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
  const [boxCode, setBoxCode] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ result: ScanResult; itemId: number | null } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [completionInfo, setCompletionInfo] = useState<{
    durationSec: number;
    qrPrintFlag: boolean;
    print: { ok: boolean; dryRun: boolean } | null;
  } | null>(null);

  // 縦/横レイアウト
  //   不具合対応：スキャンで /tablet → /tablet/inspect/[pkNo] へ遷移すると
  //   従来は常に portrait=false で起動し、縦持ち作業中でも 3 ペインの横レイアウトに
  //   切り替わる現象が発生していた。
  //   対策：
  //    1. 初期値は **画面サイズから自動判定**（縦長なら portrait=true）
  //    2. ユーザーが手動トグルした選択は localStorage に保持し、再起動・遷移で復元
  //    3. orientation 変化時にも window サイズで再判定
  const [portrait, setPortrait] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const saved = localStorage.getItem('tablet:portrait');
      if (saved === 'true') return true;
      if (saved === 'false') return false;
    } catch {
      /* localStorage 不可は無視 */
    }
    return window.innerHeight > window.innerWidth;
  });

  // 手動トグルを永続化
  const togglePortrait = useCallback(() => {
    setPortrait((p) => {
      const next = !p;
      try {
        localStorage.setItem('tablet:portrait', String(next));
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  // 物理回転（端末を傾けた等）に追従して再判定
  //   ※ ユーザーが明示的にトグルしている場合は localStorage 値を優先
  useEffect(() => {
    function onResize() {
      try {
        const saved = localStorage.getItem('tablet:portrait');
        if (saved === 'true' || saved === 'false') return; // 手動選択を尊重
      } catch {
        /* noop */
      }
      setPortrait(window.innerHeight > window.innerWidth);
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // フラッシュアニメ
  const [flash, setFlash] = useState<FlashColor>(null);

  // モーダル制御
  // - showNotices: 起動時の連絡事項モーダル（PC からの「連絡事項」「メッセージ送信」を表示）
  // - showFinalCheck: 商品検品完了で自動展開する最終チェックモーダル（D-1）
  //   モック準拠（タブレット検品モック_v0.18.html L1453-1499 koudokuModal）:
  //   のし☑ + 同梱物☑ + 商品検品サマリー + 納品書スキャンを 1 モーダルに集約
  // ※ 連絡事項は idle 画面で既に確認済みのため、検品画面では既定 false。
  //    F1 押下時に再表示する。
  const [showNotices, setShowNotices] = useState(false);
  const [showFinalCheck, setShowFinalCheck] = useState(false);
  const [forceTarget, setForceTarget] = useState<InspectionItem | null>(null);
  const [qtyTarget, setQtyTarget] = useState<InspectionItem | null>(null);
  const [holdMenuOpen, setHoldMenuOpen] = useState(false);
  const [holdContactOpen, setHoldContactOpen] = useState(false);

  // Sticky 強制検品モード（A-15）
  const sticky = useStickyForceOk();

  // 検品スキャン音 / 完了音（2026-05-23 追加）
  const {
    playBeep,
    playError,
    playSuccess,
    enabled: soundEnabled,
    setEnabled: setSoundEnabled,
  } = useScanSound();

  const scanInputRef = useRef<HTMLInputElement>(null);
  // 自動展開の二重発火防止（モック L2167 と同等）
  const autoExpandedThisLoad = useRef(false);

  const allInspected = order.items.every((it) => it.forceOk || it.scannedQty >= it.qty);

  const triggerFlash = useCallback((color: FlashColor) => {
    setFlash(color);
    setTimeout(() => setFlash(null), 500);
  }, []);

  // セッション開始
  // D-2: 起動時の NoshiConfirmation 表示を撤去
  // 起動時モーダルは「連絡事項（PC からの発信）」のみ。のしは最終チェックで一緒に確認する。
  useEffect(() => {
    if (sessionId || completed) return;
    fetch('/api/inspect/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkNo: order.pkNo }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.data?.id) setSessionId(j.data.id);
        else setErrorMsg(j.message ?? 'セッション開始に失敗');
      })
      .catch((e) => setErrorMsg(String(e)));
  }, [order.pkNo, sessionId, completed]);

  // モーダルが閉じたら入力フォーカス回復
  useEffect(() => {
    if (!showNotices && !showFinalCheck) {
      scanInputRef.current?.focus();
    }
  }, [showNotices, showFinalCheck]);

  // D-1: 商品検品完了で最終チェックモーダルを自動展開（モック L2162-2181 準拠）
  //   - 350ms ディレイ
  //   - autoExpandedThisLoad ref で二重発火防止
  //   - 起動時連絡事項表示中・既に開いている時は発火しない
  useEffect(() => {
    if (
      allInspected &&
      !autoExpandedThisLoad.current &&
      !showNotices &&
      !showFinalCheck &&
      !completed &&
      sessionId
    ) {
      autoExpandedThisLoad.current = true;
      const id = setTimeout(() => {
        setShowFinalCheck(true);
      }, 350);
      return () => clearTimeout(id);
    }
    // 完了状態が崩れた（後から強制OKを取り消した等）ら次回再展開を許す
    if (!allInspected) autoExpandedThisLoad.current = false;
  }, [allInspected, showNotices, showFinalCheck, completed, sessionId]);

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

  // 商品スキャンのみ。納品書は最終チェックモーダル内で別途処理（D-1）
  async function onScan(e: React.FormEvent) {
    e.preventDefault();
    const value = scanInput.trim();
    if (!value || !sessionId) return;
    setScanInput('');
    setBusy(true);
    setErrorMsg(null);

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
        playError();
      } else {
        setLastResult(j.data);
        if (j.data.result === 'matched') {
          triggerFlash('green');
          playBeep();
          applyScannedQtyLocal(j.data.itemId, j.data.scannedQty);
        } else if (j.data.result === 'already_done') {
          // ③ 2026-06-03: 完了済み商品の再スキャン（個数オーバー相当）はエラー音に
          triggerFlash('blue');
          playError();
        } else {
          triggerFlash('red');
          playError();
        }
      }
    } finally {
      setBusy(false);
      scanInputRef.current?.focus();
    }
  }

  /**
   * ④ 2026-06-03 軽量化: matched 応答の scannedQty で該当行のみローカル更新し、
   *   伝票全体の再取得（refreshOrder）を避ける。itemId/qty 欠落時のみ全体再取得にフォールバック。
   */
  function applyScannedQtyLocal(itemId: number | null, scannedQty: number | null) {
    if (itemId == null || scannedQty == null) {
      void refreshOrder();
      return;
    }
    setOrder((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === itemId ? { ...it, scannedQty } : it,
      ),
    }));
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
        playError();
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      setLastResult(j.data);
      if (j.data.result === 'matched') {
        triggerFlash('green');
        playBeep();
        applyScannedQtyLocal(j.data.itemId, j.data.scannedQty);
      } else if (j.data.result === 'over_scan') {
        triggerFlash('red');
        playError();
        throw new Error('残数を超えています');
      } else if (j.data.result === 'already_done') {
        // ③ 2026-06-03: 完了済み商品の再入力はエラー音に
        triggerFlash('blue');
        playError();
      } else {
        triggerFlash('red');
        playError();
      }
    } finally {
      setBusy(false);
      scanInputRef.current?.focus();
    }
  }

  async function onTogglePrintFlag() {
    // ②（2026-06-14）：QRフラグは検品中いつでも☑可・保持。トグル後にスキャン入力へ
    //   フォーカスを戻さないと、スキャン入力が宙に浮き「検品が進まない」不具合になる。
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
      // 検品継続のためスキャン入力へフォーカス復帰（②バグ修正）
      scanInputRef.current?.focus();
    }
  }

  /**
   * 納品書スキャン受領後のエントリ。
   * 2026-06-03: 完了と印刷を分離。納品書スキャンで**即・検品完了（印刷しない）**し、
   *   印刷は完了画面（CompleteScreen）の後で印刷確認モーダルにて行う。
   */
  function onInvoiceScanned(invoiceValue: string) {
    setShowFinalCheck(false);
    void actuallyComplete(invoiceValue, false); // doPrint=false → skipPrint:true（ここでは印刷しない）
  }

  async function actuallyComplete(invoiceValue: string, doPrint: boolean | null) {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/inspect/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          pkNo: order.pkNo,
          invoiceNo: invoiceValue,
          ...(boxCode ? { boxCode } : {}),
          // doPrint=null は API 側のデフォルト挙動（qrPrintFlag に従う）
          ...(doPrint !== null ? { skipPrint: !doPrint } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErrorMsg(j.message ?? '完了処理失敗');
        playError();
        return;
      }
      setCompleted(true);
      setShowFinalCheck(false);
      setCompletionInfo({
        durationSec: j.data.durationSec,
        qrPrintFlag: j.data.qrPrintFlag,
        print: j.data.print,
      });
      // 検品完了：達成感ある上昇アルペジオ
      playSuccess();
    } finally {
      setBusy(false);
    }
  }

  // F5 / フッタ「中断」: 保留メニューを開く（A-17）
  function onHold() {
    setHoldMenuOpen(true);
  }

  // F2 強制OK ボタン（フッタ）: 先頭の未完了行を強制OK 対象として ForceOkModal を起動
  function onFooterForceOk() {
    const target = order.items.find(
      (it) => !it.forceOk && it.scannedQty < it.qty,
    );
    if (target) onForceOk(target);
  }

  // F4 一括検品（モック skipAndFinish 準拠）。
  // ④ 改修: 既に全件完了している場合は最終チェックモーダルを再表示する。
  async function onBulkComplete() {
    if (!sessionId) return;
    // 既に全件完了 → 最終チェックモーダルを再オープン
    if (allInspected) {
      autoExpandedThisLoad.current = true; // 再オープンを許容（自動再展開と区別）
      setShowFinalCheck(true);
      return;
    }
    if (!confirm('残り全ての商品を一括検品で完了させますか？（強制OK 相当）')) return;
    const targets = order.items.filter(
      (it) => !it.forceOk && it.scannedQty < it.qty,
    );
    setBusy(true);
    setErrorMsg(null);
    try {
      // Sprint Y-15: 並列で投げて結果を集約。失敗があればユーザーに通知。
      const results = await Promise.allSettled(
        targets.map((it) =>
          fetch('/api/inspect/force-ok', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              itemId: it.id,
              reason: 'F4 一括検品',
            }),
          }).then(async (r) => {
            if (!r.ok) {
              const j = await r.json().catch(() => ({}));
              throw new Error(j?.message ?? `HTTP ${r.status}`);
            }
            return true;
          }),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        setErrorMsg(`一括検品: ${failed} 件の処理に失敗しました（成功 ${results.length - failed} 件）`);
      }
      await refreshOrder();
    } finally {
      setBusy(false);
    }
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

  // 検品中断（破棄）：途中検品を破棄して未検品に戻す（保留とは別・2026-06-14）
  async function submitInspectionRelease() {
    if (!sessionId) {
      setHoldMenuOpen(false);
      return;
    }
    setBusy(true);
    setHoldMenuOpen(false);
    try {
      const res = await fetch('/api/inspect/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (res.ok) router.push('/tablet');
      else setErrorMsg((await res.json()).message ?? '中断（破棄）失敗');
    } finally {
      setBusy(false);
    }
  }

  // === 完了画面（モック L577-590 .complete-screen 準拠 — 緑グラデ全面） ===
  if (completed) {
    return <CompleteScreen order={order} completionInfo={completionInfo} />;
  }

  // === メイン画面（モック準拠） ===
  // フラッシュ色（モック準拠で薄め半透明）
  const flashBg =
    flash === 'green'
      ? 'rgba(16, 185, 129, 0.25)'
      : flash === 'red'
        ? 'rgba(239, 68, 68, 0.30)'
        : flash === 'blue'
          ? 'rgba(59, 130, 246, 0.25)'
          : 'transparent';

  return (
    <main
      className="h-screen overflow-hidden flex flex-col p-3"
      style={{ background: '#0f172a', color: '#f8fafc' }}
    >
      {/* フラッシュオーバーレイ */}
      {flash && (
        <div
          className={cn(
            'fixed inset-0 z-[60] pointer-events-none transition-opacity duration-300',
            flash === 'red' && 'animate-pulse',
          )}
          style={{ background: flashBg }}
        />
      )}

      {/* モーダル */}
      {showNotices && (
        <NoticesModal variant="tablet-launch" onClose={() => setShowNotices(false)} />
      )}
      <FinalCheckModal
        open={showFinalCheck}
        pkNo={order.pkNo}
        noshiName={order.noshiName}
        qrPrintFlag={order.qrPrintFlag}
        // ★ サンドイッチ照合: 取込済みの納品書№（権威値）
        expectedInvoiceNo={order.invoiceNo}
        items={order.items.map((it) => ({
          id: it.id,
          productName: it.productName,
          qty: it.qty,
          scannedQty: it.scannedQty,
          forceOk: it.forceOk,
          // 2026-05-31 緊急修正: 納品書誤読検出のため商品コード/JAN を渡す
          productCode: it.productCode,
          productJan: it.productJan,
        }))}
        onConfirm={(invoiceValue) => onInvoiceScanned(invoiceValue)}
        onBack={() => setShowFinalCheck(false)}
        variant="tablet"
      />

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
          if (qtyTarget) await applyManualQty(qtyTarget, n);
          setQtyTarget(null);
        }}
        onCancel={() => setQtyTarget(null)}
      />
      <HoldMenuModal
        open={holdMenuOpen}
        onSelectInspectionHold={() => submitInspectionHold()}
        onSelectRelease={() => submitInspectionRelease()}
        onSelectContact={() => {
          setHoldMenuOpen(false);
          setHoldContactOpen(true);
        }}
        onCancel={() => setHoldMenuOpen(false)}
      />
      <HoldContactModal
        open={holdContactOpen}
        pkNo={order.pkNo}
        orderNo={order.orderNo}
        customerCode={order.customerCode}
        customerName={order.destName}
        staffCode={employee?.staffCode}
        onSent={() => setHoldContactOpen(false)}
        onCancel={() => setHoldContactOpen(false)}
      />

      {/* Sticky 強制検品バナー（モック L43-66 .force-banner 準拠） */}
      {sticky.active && (
        <div
          className="flex items-center gap-3 px-5 py-2 rounded-t-lg shrink-0 mb-1 animate-tablet-pulse-banner"
          style={{
            background: 'linear-gradient(90deg, #ea580c, #c2410c)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 'bold',
          }}
        >
          <span>⚠ 強制検品モード 実行中</span>
          <span className="opacity-90 font-normal" style={{ fontSize: 12 }}>
            理由コード: <b>{sticky.code}</b>
          </span>
          <button
            onClick={sticky.deactivate}
            className="ml-auto px-3 py-1 rounded font-bold"
            style={{ background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 12 }}
          >
            解除
          </button>
        </div>
      )}

      {/* 不可視スキャン入力 */}
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

      {/* タブレット コンテナ（モック .tablet 準拠） */}
      <div
        className={cn(
          'flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden',
          portrait && 'tablet-portrait',
        )}
        style={{ background: '#1e293b', padding: 14 }}
      >
        {/* ヘッダ（モック L72-105 / 52px height） */}
        <Header
          order={order}
          employee={employee}
          portrait={portrait}
          onTogglePortrait={togglePortrait}
          onExit={() => router.push('/tablet')}
          soundEnabled={soundEnabled}
          onToggleSound={() => setSoundEnabled(!soundEnabled)}
        />

        {/* 本体: 横は 3 ペイン flex / 縦は縦積み */}
        <div
          className={cn('flex-1 min-h-0 mt-2.5')}
          style={{
            display: 'flex',
            flexDirection: portrait ? 'column' : 'row',
            gap: portrait ? 6 : 10,
            overflowY: portrait ? 'auto' : 'visible',
          }}
        >
          {/* U-4: 縦向きは 1 つのコンパクトヘッダーに統合（重複情報を排除し、商品 5 つが見える領域を確保） */}
          {portrait ? (
            <PortraitInfoCompact
              order={order}
              busy={busy}
              onTogglePrintFlag={onTogglePrintFlag}
            />
          ) : (
            <LeftPane
              order={order}
              onTogglePrintFlag={onTogglePrintFlag}
              boxCode={boxCode}
              onSelectBox={setBoxCode}
              busy={busy}
              portrait={portrait}
            />
          )}

          {/* 中央ペイン */}
          <CenterPane
            items={order.items}
            lastResult={lastResult}
            errorMsg={errorMsg}
            allInspected={allInspected}
            onOpenKeypad={(it) => setQtyTarget(it)}
          />

          {/* 右ペイン (290px) — 横向き専用 */}
          {!portrait && (
            <RightPane
              destName={order.destName}
              destZip={order.destZip}
              destAddr={order.destAddr}
              noshiName={order.noshiName}
              pkNo={order.pkNo}
            />
          )}

          {/* 縦時: portraitBottomRow（箱 + 同梱物） */}
          {portrait && (
            <PortraitBottomRow
              pkNo={order.pkNo}
              boxCode={boxCode}
              onSelectBox={setBoxCode}
            />
          )}
        </div>

        {/* フッタ（モック L370-412 / 82px / 6 ボタン） */}
        <Footer
          allInspected={allInspected}
          onHold={onHold}
          onExit={() => router.push('/tablet')}
          onForceOk={onFooterForceOk}
          onBulkComplete={onBulkComplete}
          busy={busy}
          portrait={portrait}
        />
      </div>
    </main>
  );
}

/* ====== 完了画面（モック L577-590 .complete-screen 準拠） + V-4 自動遷移 ====== */
function CompleteScreen({
  order,
  completionInfo,
}: {
  order: InspectionOrder;
  completionInfo: {
    durationSec: number;
    qrPrintFlag: boolean;
    print: { ok: boolean; dryRun: boolean } | null;
  } | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [scanInput, setScanInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  // 2026-06-03 ②: 完了画面の後、QR印刷フラグ ON なら自動で印刷確認を表示。
  //   表示中は 3.5 秒自動遷移・次伝票スキャンを抑止し、印刷/印刷しない の選択を待つ。
  const [showPrint, setShowPrint] = useState(completionInfo?.qrPrintFlag === true);
  const [printing, setPrinting] = useState(false);

  // X-2 改修: マルチパス フォーカス（rAF + setTimeout × 複数）+ 定期再フォーカス
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    requestAnimationFrame(focus);
    const t1 = setTimeout(focus, 50);
    const t2 = setTimeout(focus, 200);
    const t3 = setTimeout(focus, 500);
    // 1 秒ごとにフォーカスチェック（どこかに奪われていたら戻す）
    const interval = setInterval(() => {
      if (
        document.activeElement !== inputRef.current &&
        !navigating &&
        inputRef.current
      ) {
        inputRef.current.focus();
      }
    }, 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearInterval(interval);
    };
  }, [navigating]);

  // X-2: グローバルキー捕捉（万一フォーカスが奪われていても動作させる保険）
  useEffect(() => {
    let buffer = '';
    let lastKeyAt = 0;
    function onKey(e: KeyboardEvent) {
      if (navigating || showPrint) return; // 印刷確認中は次伝票スキャンを抑止
      // 自前の input にフォーカスがあれば input 側で処理されるのでスキップ
      if (document.activeElement === inputRef.current) return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      // 他の input/textarea にフォーカスがある場合は捕捉しない（モーダル等）
      if (tag === 'input' || tag === 'textarea') return;

      const now = Date.now();
      if (now - lastKeyAt > 200) buffer = '';
      lastKeyAt = now;

      if (e.key === 'Enter') {
        const value = buffer.trim();
        buffer = '';
        if (!value) return;
        e.preventDefault();
        void submitNext(value);
        return;
      }
      if (e.key.length === 1) {
        buffer += e.key;
        setScanInput(buffer);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, showPrint]);

  // モック L2665 準拠: 3.5 秒経過で自動的に tablet ホーム（伝票スキャン画面）へ戻る
  //   2026-06-03 ②: 印刷確認モーダル表示中は自動遷移を抑止（印刷判断を待つ）。
  useEffect(() => {
    if (navigating || showPrint) return;
    const id = setTimeout(() => {
      if (!navigating) router.push('/tablet');
    }, 3500);
    return () => clearTimeout(id);
  }, [router, navigating, showPrint]);

  // 2026-06-03 ②: 印刷確認の決定。印刷ありなら reprint API で印字 → 待機画面へ。
  async function decidePrint(doPrint: boolean) {
    if (printing) return;
    setNavigating(true);
    try {
      if (doPrint) {
        setPrinting(true);
        // 完了時の初回印刷は通常印刷 API（is_reprint=false で記録）。
        await fetch('/api/print/qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pkNo: order.pkNo }),
        }).catch(() => {});
      }
    } finally {
      setShowPrint(false);
      router.push('/tablet');
    }
  }

  async function submitNext(value: string) {
    if (navigating) return;
    setNavigating(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(value)}`);
      if (res.status === 404) {
        setErrorMsg(`該当する出荷指示が見つかりません: ${value}`);
        setScanInput('');
        setNavigating(false);
        return;
      }
      if (!res.ok) {
        setErrorMsg(`エラー: HTTP ${res.status}`);
        setScanInput('');
        setNavigating(false);
        return;
      }
      const j = await res.json();
      const nextPkNo = j.data?.pkNo as string | undefined;
      if (!nextPkNo) {
        setErrorMsg('PkNo が取得できません');
        setScanInput('');
        setNavigating(false);
        return;
      }
      const status = j.data?.status as string | undefined;
      // 保留・完了済みは tablet ホームに戻して通常フローに乗せる
      if (status === 'held' || status === 'packed' || status === 'shipped') {
        router.push(`/tablet?pkNo=${encodeURIComponent(nextPkNo)}`);
        return;
      }
      router.push(`/tablet/inspect/${encodeURIComponent(nextPkNo)}`);
    } catch (err) {
      setErrorMsg(String(err));
      setNavigating(false);
    }
  }

  async function onScanNext(e: React.FormEvent) {
    e.preventDefault();
    const value = scanInput.trim();
    if (!value || navigating) return;
    await submitNext(value);
    setScanInput('');
  }

  // モック準拠: 商品の検品済み合計点数（強制OK含む）
  const totalScannedQty = order.items.reduce(
    (s, it) => s + (it.scannedQty ?? 0),
    0,
  );

  return (
    <>
    <main
      className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
      style={{
        background: 'linear-gradient(135deg, #065f46, #047857)',
        color: '#fff',
        gap: 14,
      }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* 不可視 input — HID スキャナの Enter を受け取るためのフォーカス維持専用 */}
      <form
        onSubmit={onScanNext}
        style={{
          position: 'absolute',
          left: -9999,
          top: -9999,
          width: 1,
          height: 1,
          overflow: 'hidden',
          opacity: 0,
        }}
        aria-hidden
      >
        <input
          ref={inputRef}
          type="text"
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          autoFocus
          autoComplete="off"
          aria-label="次の伝票バーコード"
          disabled={navigating}
          tabIndex={-1}
        />
      </form>

      {/* モック L1255-1261 準拠: ✓ 140px / h1 36px / 完了サマリ / 補足 / スキャン誘導 */}
      <div
        style={{
          fontSize: 140,
          color: '#fff',
          filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.3))',
          lineHeight: 1,
        }}
      >
        ✓
      </div>
      <h1
        style={{
          fontSize: 36,
          color: '#fff',
          fontWeight: 'bold',
          margin: 0,
        }}
      >
        検品・梱包 完了
      </h1>
      <p style={{ fontSize: 15, color: '#d1fae5', margin: 0 }}>
        伝票{' '}
        <b
          style={{
            color: '#fff',
            fontFamily: 'Consolas, monospace',
            letterSpacing: 1,
          }}
        >
          {order.pkNo}
        </b>{' '}
        を <b style={{ color: '#fff' }}>{totalScannedQty}</b> 点 で完了しました
      </p>
      {completionInfo && (
        <p style={{ fontSize: 13, color: '#a7f3d0', margin: 0 }}>
          所要 {completionInfo.durationSec} 秒
          {completionInfo.qrPrintFlag
            ? completionInfo.print
              ? ` ・ QRラベル ${completionInfo.print.ok ? '送信済' : '送信失敗'}${completionInfo.print.dryRun ? '（DRY-RUN）' : ''}`
              : ' ・ QR印刷フラグ ON'
            : ' ・ QR印刷なし'}
        </p>
      )}
      <p
        style={{ fontSize: 13, color: '#a7f3d0', margin: 0 }}
        className="animate-pulse"
      >
        次の伝票をスキャンしてください
      </p>

      {errorMsg && (
        <div
          style={{
            background: 'rgba(127, 29, 29, 0.7)',
            color: '#fecaca',
            padding: '8px 14px',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          ⚠ {errorMsg}
        </div>
      )}
    </main>

    {/* 2026-06-03 ②: 完了後に自動表示する印刷確認。印刷/印刷しない → 待機画面へ */}
    <PrintConfirmModal
      open={showPrint}
      order={{
        pkNo: order.pkNo,
        destName: order.destName,
        destZip: order.destZip,
        carrierName: order.carrier?.name ?? null,
        cool: !!order.carrier?.cool,
        noshiName: order.noshiName,
        invoiceNo: order.invoiceNo ?? '',
      }}
      onConfirm={(doPrint) => void decidePrint(doPrint)}
      onCancel={() => void decidePrint(false)}
    />
    </>
  );
}

/* ====== ヘッダ（モック L72-105 準拠） ====== */
function Header({
  order,
  employee,
  portrait,
  onTogglePortrait,
  onExit,
  soundEnabled,
  onToggleSound,
}: {
  order: InspectionOrder;
  employee: Props['employee'];
  portrait: boolean;
  onTogglePortrait: () => void;
  onExit: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
}) {
  const [now, setNow] = useState<string>(() =>
    new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setNow(
        new Date().toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header
      className="flex items-center shrink-0 rounded-[10px]"
      style={{
        height: portrait ? 48 : 52,
        background: '#0f172a',
        padding: '0 18px',
        gap: 16,
      }}
    >
      {/* U-1: テキスト → 公式ロゴへ差し替え */}
      <div className="flex items-center gap-2 shrink-0">
        <LogiSmileLogo height={portrait ? 24 : 28} />
        <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'normal' }}>
          タブレット
        </span>
      </div>
      <span
        className="rounded-md"
        style={{
          background: '#334155',
          padding: '6px 12px',
          fontSize: 13,
        }}
      >
        テーブル{' '}
        <b style={{ color: '#fbbf24', marginLeft: 6, fontSize: 15 }}>
          {employee?.deviceCode ?? '—'}
        </b>
      </span>
      {/* U-4: 縦向きでは PkNo はパネル左側に大きく出るので、ヘッダーチップは横向きでのみ表示 */}
      {!portrait && (
        <span
          className="rounded-md font-mono"
          style={{
            background: '#1e293b',
            padding: '4px 10px',
            fontSize: 12,
            color: '#fbbf24',
            letterSpacing: 1,
          }}
          title="ピッキングNo"
        >
          {order.pkNo}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {/* 検品スキャン音 ON/OFF（2026-05-23 追加） */}
      <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} variant="tablet" />
      <button
        onClick={onTogglePortrait}
        title="縦横切替"
        style={{
          background: '#334155',
          color: '#cbd5e1',
          padding: '4px 10px',
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        {portrait ? '◫ 横向き' : '▯ 縦向き'}
      </button>
      <span style={{ color: '#cbd5e1', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        {now}
      </span>
      {employee && (
        <span className="flex items-center gap-2" style={{ fontSize: 13 }}>
          <span
            style={{
              width: 30,
              height: 30,
              background: '#475569',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
            }}
          >
            {employee.name[0]}
          </span>
          {employee.name}
        </span>
      )}
      <button
        onClick={onExit}
        title="検品を中断"
        style={{ color: '#cbd5e1', fontSize: 18 }}
      >
        ⏻
      </button>
    </header>
  );
}

/* ====== 左ペイン（モック L147-234 .pane-left 準拠） ====== */
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
  // 出荷予定日表示（status を日本語化）
  const STATUS_LABEL: Record<string, string> = {
    pending: '未着手',
    inspecting: '検品中',
    packed: '完了',
    shipped: '出荷済',
    held: '保留中',
  };
  const statusLabel = STATUS_LABEL[order.status] ?? order.status;
  const carrierName = order.carrier?.name ?? '—';

  return (
    <div
      style={{
        width: portrait ? '100%' : 340,
        background: '#1f2937',
        borderRadius: 10,
        padding: portrait ? '5px 10px' : 14,
        display: 'flex',
        flexDirection: portrait ? 'row' : 'column',
        flexWrap: portrait ? 'wrap' : 'nowrap',
        gap: portrait ? 6 : 10,
        overflowY: portrait ? 'visible' : 'auto',
        flexShrink: 0,
        alignItems: portrait ? 'center' : 'stretch',
      }}
    >
      {/* PkNo 大表示（縦時は flex-basis 100%） */}
      <div style={portrait ? { flexBasis: '100%' } : undefined}>
        <div className="section-title-mock">ピッキングNo</div>
        <div
          className="font-mono"
          style={{
            background: '#0f172a',
            padding: portrait ? '4px 8px' : '10px 12px',
            borderRadius: 8,
            fontSize: portrait ? 13 : 19,
            color: '#fbbf24',
            letterSpacing: 1,
            textAlign: 'center',
            border: '2px solid #334155',
          }}
        >
          {order.pkNo}
        </div>
      </div>

      <KvField label="出荷予定日" value={statusLabel} big portrait={portrait} />
      <KvField label="配送便" value={carrierName} portrait={portrait} />
      <KvField
        label="納品書No"
        value={order.invoiceNo ?? '—'}
        mono
        portrait={portrait}
      />
      {order.noshiName && (
        <KvField label="熨斗名称" value={order.noshiName} portrait={portrait} />
      )}

      {/* 印刷フラグトグル（モック L207-234 .print-flag 準拠） — 縦時は portraitInfoRow に移動するので非表示 */}
      {!portrait && (
        <div
          onClick={() => !busy && onTogglePrintFlag()}
          className="cursor-pointer transition-all"
          style={{
            background: order.qrPrintFlag ? '#2a0f1d' : '#0f172a',
            border: `2px solid ${order.qrPrintFlag ? '#db2777' : '#334155'}`,
            borderRadius: 8,
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              border: `2px solid ${order.qrPrintFlag ? '#db2777' : '#475569'}`,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 16,
              fontWeight: 'bold',
              background: order.qrPrintFlag ? '#db2777' : 'transparent',
              color: order.qrPrintFlag ? '#fff' : 'transparent',
            }}
          >
            ✓
          </span>
          <div style={{ fontSize: 13, color: '#f1f5f9' }}>
            QR印刷フラグ
            <small
              style={{ color: '#94a3b8', display: 'block', fontSize: 10, marginTop: 1 }}
            >
              {order.qrPrintFlag ? 'ON（自動印刷）' : 'OFF（印刷なし）'}
            </small>
          </div>
        </div>
      )}

      {/* 推奨箱（横向きのみ表示。縦向きは portraitBottomRow に移動） */}
      {!portrait && (
        <div
          style={{
            background: '#0b1220',
            borderLeft: '3px solid #67e8f9',
            borderRadius: 6,
            padding: '8px 10px',
          }}
        >
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

function KvField({
  label,
  value,
  big,
  mono,
  portrait,
}: {
  label: string;
  value: string;
  big?: boolean;
  mono?: boolean;
  portrait?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: portrait ? 1 : 2,
        fontSize: portrait ? 11 : 13,
        flexShrink: portrait ? 0 : undefined,
        minWidth: portrait ? 110 : undefined,
      }}
    >
      <span
        className="section-title-mock"
        style={{ fontSize: portrait ? 9 : 10, marginBottom: 0 }}
      >
        {label}
      </span>
      <span
        style={{
          color: big ? '#fbbf24' : '#f1f5f9',
          fontWeight: big ? 'bold' : 500,
          fontSize: big ? (portrait ? 13 : 15) : portrait ? 11 : 13,
          fontFamily: mono ? 'Consolas, monospace' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ====== 中央ペイン（モック L236-320 .pane-center 準拠） ====== */
function CenterPane({
  items,
  lastResult,
  errorMsg,
  allInspected,
  onOpenKeypad,
}: {
  items: InspectionItem[];
  lastResult: { result: ScanResult; itemId: number | null } | null;
  errorMsg: string | null;
  allInspected: boolean;
  onOpenKeypad: (item: InspectionItem) => void;
}) {
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const scannedQty = items.reduce(
    (s, i) => s + (i.forceOk ? i.qty : i.scannedQty),
    0,
  );
  const currentStep: 0 | 1 | 2 = allInspected ? 2 : 1;

  // ユーザー要望（2026-05-20）：検品完了/強制OK 行を一覧最下段にソート。
  //   - 点数の多い伝票で「未検品が見切れる」事故を防止
  //   - 元の sortOrder は同状態内で保持（安定ソート）
  const sortedItems = [...items].sort((a, b) => {
    const aDone = a.forceOk || a.scannedQty >= a.qty;
    const bDone = b.forceOk || b.scannedQty >= b.qty;
    if (aDone !== bDone) return aDone ? 1 : -1; // 未完了→完了
    return a.id - b.id; // 同状態内は id（取込時の順序）昇順
  });

  return (
    <div
      style={{
        flex: 1,
        background: '#1f2937',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {/* center-header: タイトル + 進捗チップ */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 'bold' }}>商品検品</div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 'bold',
            color: '#fbbf24',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {scannedQty}
          <small style={{ fontSize: 13, color: '#94a3b8', margin: '0 4px', fontWeight: 'normal' }}>
            /
          </small>
          {totalQty}
          <small style={{ fontSize: 13, color: '#94a3b8', margin: '0 4px', fontWeight: 'normal' }}>
            点
          </small>
        </div>
      </div>

      {/* flow-steps: 3 段階 */}
      <FlowSteps currentStep={currentStep} />

      {/* scan-line-list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          background: '#0f172a',
          borderRadius: 8,
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {sortedItems.map((it) => (
          <ScanLine
            key={it.id}
            item={it}
            isLast={lastResult?.itemId === it.id}
            lastResult={lastResult}
            onOpenKeypad={onOpenKeypad}
          />
        ))}
      </div>

      {/* 直近スキャン結果 / エラー */}
      {(lastResult || errorMsg) && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 6,
            borderTop: '1px solid #334155',
          }}
        >
          {errorMsg && (
            <div style={{ color: '#fca5a5', fontSize: 13, fontWeight: 'bold' }}>
              ⚠ {errorMsg}
            </div>
          )}
          {!errorMsg && lastResult && <ScanResultBanner result={lastResult.result} />}
        </div>
      )}

      {/* 全件完了プロンプト */}
      {allInspected && (
        <div
          className="animate-pulse"
          style={{
            marginTop: 8,
            padding: 8,
            background: '#064e3b',
            borderRadius: 6,
            color: '#6ee7b7',
            fontSize: 13,
            fontWeight: 'bold',
          }}
        >
          ✓ 全件検品完了 — 最終チェックを開きます…
        </div>
      )}
    </div>
  );
}

/** flow-steps（モック L261-278） */
function FlowSteps({ currentStep }: { currentStep: 0 | 1 | 2 }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, fontSize: 11 }}>
      {FLOW_STEPS.map((label, idx) => {
        const done = idx < currentStep;
        const active = idx === currentStep;
        const bg = done ? '#064e3b' : active ? '#422006' : '#0f172a';
        const color = done ? '#6ee7b7' : active ? '#fbbf24' : '#64748b';
        const border = done ? '#10b981' : active ? '#fbbf24' : '#334155';
        return (
          <div
            key={label}
            style={{
              flex: 1,
              padding: '6px 10px',
              background: bg,
              borderRadius: 5,
              textAlign: 'center',
              border: `1px solid ${border}`,
              color,
              fontWeight: active ? 'bold' : 'normal',
            }}
          >
            <span style={{ fontSize: 10, marginRight: 3, opacity: 0.7 }}>
              {idx === 0 ? '①' : idx === 1 ? '②' : '③'}
            </span>
            {idx === 2 ? '最終チェック → 納品書スキャン' : label}
          </div>
        );
      })}
    </div>
  );
}

/** scan-line（モック L290-320 準拠 — 強制OK は F2/フッタ統一、行上は省略） */
function ScanLine({
  item,
  isLast,
  lastResult,
  onOpenKeypad,
}: {
  item: InspectionItem;
  isLast: boolean;
  lastResult: { result: ScanResult; itemId: number | null } | null;
  onOpenKeypad: (i: InspectionItem) => void;
}) {
  const done = item.forceOk || item.scannedQty >= item.qty;
  const warn = isLast && lastResult?.result === 'over_scan';

  const bg = warn ? '#450a0a' : done ? '#064e3b' : '#1e293b';
  const borderLeft = warn ? '#ef4444' : done ? '#10b981' : '#64748b';

  return (
    <div
      className={warn ? 'animate-tablet-shake' : ''}
      style={{
        // ①再修正: 強制OK 列を撤去し、商品名 1fr / 数量 / 数量入力ボタン の 4 列構成
        display: 'grid',
        gridTemplateColumns: '36px 1fr 90px 110px',
        gap: 10,
        alignItems: 'center',
        padding: '10px 12px',
        background: bg,
        borderRadius: 6,
        borderLeft: `5px solid ${borderLeft}`,
        transition: 'all 0.2s',
      }}
    >
      <div
        style={{
          fontSize: 20,
          textAlign: 'center',
          color: done ? '#10b981' : '#64748b',
        }}
      >
        {done ? '✓' : '○'}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 'bold',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.productName}
          </span>
          {item.productFrozen && (
            <span
              style={{
                fontSize: 10,
                background: '#1e3a8a',
                color: '#67e8f9',
                padding: '1px 6px',
                borderRadius: 3,
                fontWeight: 'bold',
                flexShrink: 0,
              }}
            >
              冷凍
            </span>
          )}
          {item.forceOk && (
            <span
              style={{
                fontSize: 10,
                background: '#422006',
                color: '#fbbf24',
                padding: '1px 6px',
                borderRadius: 3,
                fontWeight: 'bold',
                flexShrink: 0,
              }}
            >
              強制
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 10,
            color: '#94a3b8',
            fontFamily: 'Consolas, monospace',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.productCode}
          {item.productJan && ` / ${item.productJan}`}
        </div>
      </div>
      {/* 数量表示（読み取り専用） */}
      <div
        style={{
          textAlign: 'center',
          fontSize: 18,
          fontWeight: 'bold',
          fontVariantNumeric: 'tabular-nums',
          color: done ? '#6ee7b7' : '#f1f5f9',
        }}
      >
        {item.scannedQty}
        <small style={{ fontSize: 11, color: '#94a3b8' }}> / {item.qty}</small>
      </div>
      {/* ①再修正: 数量入力ボタン（右端へ寄せ・強制OK 撤去） */}
      <div style={{ textAlign: 'right' }}>
        {!done && (
          <button
            onClick={() => onOpenKeypad(item)}
            title="数量を直接入力（残数を加算）"
            style={{
              fontSize: 12,
              background: '#1e40af',
              color: '#fff',
              padding: '7px 10px',
              borderRadius: 6,
              fontWeight: 'bold',
              border: '1px solid #3b82f6',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              minWidth: 100,
              justifyContent: 'center',
            }}
            className="hover:brightness-110 active:scale-95"
          >
            🔢 数量入力
          </button>
        )}
      </div>
    </div>
  );
}

function ScanResultBanner({ result }: { result: ScanResult }) {
  const map: Record<ScanResult, { text: string; color: string }> = {
    matched: { text: '✓ MATCHED', color: '#10b981' },
    over_scan: { text: '⚠ OVER SCAN（数量超過）', color: '#ef4444' },
    not_found: { text: '✗ NOT FOUND（マスタ未登録）', color: '#ef4444' },
    already_done: { text: 'ℹ ALREADY DONE', color: '#3b82f6' },
  };
  const m = map[result];
  return (
    <div style={{ fontSize: 13, fontWeight: 'bold', color: m.color }}>{m.text}</div>
  );
}

/* ====== 右ペイン (横向き) — モック L322-368 .pane-right 準拠 ====== */
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
    <div
      style={{
        width: 290,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        flexShrink: 0,
        minHeight: 0,
      }}
    >
      {/* お届け先 (.ship-to) */}
      <div
        style={{
          background: '#1f2937',
          borderRadius: 10,
          padding: 14,
          flexShrink: 0,
        }}
      >
        <div className="section-title-mock">お届け先</div>
        <div
          style={{
            fontSize: 11,
            color: '#94a3b8',
            marginBottom: 2,
            fontFamily: 'Consolas, monospace',
          }}
        >
          {destZip ?? ''}
        </div>
        <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.55 }}>
          {destAddr ?? '—'}
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 'bold',
            marginTop: 6,
          }}
        >
          {destName ?? '—'} 様
        </div>
      </div>

      {/* 同梱物プレビュー */}
      <div
        style={{
          background: '#1f2937',
          borderRadius: 10,
          padding: 14,
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        <div className="section-title-mock">同梱物プレビュー</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
          最終☑はモーダルで実施
        </div>
        {noshiName && (
          <div
            style={{
              padding: 9,
              background: '#0f172a',
              borderRadius: 6,
              marginBottom: 5,
              fontSize: 13,
              borderLeft: '3px solid #db2777',
            }}
          >
            <div style={{ color: '#f472b6', fontSize: 11, marginBottom: 2 }}>🎀 のし</div>
            <div style={{ color: '#fbcfe8', fontWeight: 'bold' }}>{noshiName}</div>
          </div>
        )}
        <div
          style={{
            padding: 9,
            background: '#0f172a',
            borderRadius: 6,
            fontSize: 11,
            color: '#94a3b8',
          }}
        >
          PkNo: <span style={{ fontFamily: 'Consolas, monospace', color: '#cbd5e1' }}>{pkNo}</span>
        </div>
      </div>
    </div>
  );
}

/* ====== 縦向き コンパクト情報ヘッダ（U-4: 重複情報を排除し、5 商品が見える高さに圧縮） ====== */
function PortraitInfoCompact({
  order,
  busy,
  onTogglePrintFlag,
}: {
  order: InspectionOrder;
  busy: boolean;
  onTogglePrintFlag: () => void;
}) {
  const STATUS_LABEL: Record<string, string> = {
    pending: '未着手',
    inspecting: '検品中',
    packed: '完了',
    shipped: '出荷済',
    held: '保留中',
  };
  return (
    <div
      style={{
        background: '#1f2937',
        borderRadius: 8,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        flexShrink: 0,
      }}
    >
      {/* 1 行目: 出荷予定日 / 配送便 / 納品書No / 印刷フラグ — PkNo はヘッダで表示済みなので省略 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '90px 1.4fr 1.4fr auto',
          gap: 8,
          alignItems: 'center',
          fontSize: 11,
        }}
      >
        <Mini label="出荷予定日" value={STATUS_LABEL[order.status] ?? order.status} bold accent />
        <Mini label="配送便" value={order.carrier?.name ?? '—'} />
        <Mini label="納品書No" value={order.invoiceNo ?? '—'} mono />
        <button
          onClick={() => !busy && onTogglePrintFlag()}
          style={{
            padding: '4px 8px',
            fontSize: 11,
            background: order.qrPrintFlag ? '#2a0f1d' : '#0f172a',
            border: `2px solid ${order.qrPrintFlag ? '#db2777' : '#334155'}`,
            borderRadius: 6,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              border: `2px solid ${order.qrPrintFlag ? '#db2777' : '#475569'}`,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              background: order.qrPrintFlag ? '#db2777' : 'transparent',
              color: order.qrPrintFlag ? '#fff' : 'transparent',
            }}
          >
            ✓
          </span>
          印刷 {order.qrPrintFlag ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* 2 行目: お届け先 + のし */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2.2fr 1fr',
          gap: 8,
          alignItems: 'flex-start',
          paddingTop: 6,
          borderTop: '1px solid #334155',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 9,
              color: '#94a3b8',
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 1,
            }}
          >
            お届け先
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 9,
                color: '#94a3b8',
                fontFamily: 'Consolas, monospace',
              }}
            >
              {order.destZip ?? ''}
            </span>
            <span style={{ fontSize: 13, fontWeight: 'bold', color: '#f1f5f9' }}>
              {order.destName ?? '—'} 様
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.3 }}>
            {order.destAddr ?? ''}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 9,
              color: '#94a3b8',
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 1,
            }}
          >
            熨斗名称
          </div>
          <div
            style={{
              fontSize: 11,
              color: order.noshiName ? '#fbbf24' : '#64748b',
              fontWeight: order.noshiName ? 'bold' : 500,
            }}
          >
            {order.noshiName ?? '— なし —'}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact KV 表示（縦向き上部の 1 行に並べる用） */
function Mini({
  label,
  value,
  mono,
  bold,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span
        style={{
          fontSize: 9,
          color: '#94a3b8',
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: bold ? 'bold' : 500,
          color: accent ? '#fbbf24' : '#f1f5f9',
          fontFamily: mono ? 'Consolas, monospace' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ====== 縦向き portraitBottomRow（モック L1086-1092 — 箱 + 同梱物） ====== */
function PortraitBottomRow({
  pkNo,
  boxCode,
  onSelectBox,
}: {
  pkNo: string;
  boxCode: string | null;
  onSelectBox: (c: string | null) => void;
}) {
  return (
    <div
      style={{
        height: 180,
        display: 'flex',
        gap: 8,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          background: '#1f2937',
          borderRadius: 10,
          padding: 10,
          overflowY: 'auto',
        }}
      >
        <BoxSuggestion
          pkNo={pkNo}
          selectedBoxCode={boxCode}
          onSelect={onSelectBox}
          density="compact"
        />
      </div>
      <div
        style={{
          flex: 1,
          background: '#1f2937',
          borderRadius: 10,
          padding: 10,
          overflowY: 'auto',
        }}
      >
        <div className="section-title-mock">同梱物プレビュー</div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          最終☑は最終チェックモーダルで実施します
        </div>
      </div>
    </div>
  );
}

/* ====== フッタ（モック L370-412 + L1264-1272 準拠） ====== */
function Footer({
  allInspected,
  onHold,
  onExit,
  onForceOk,
  onBulkComplete,
  busy,
  portrait,
}: {
  allInspected: boolean;
  onHold: () => void;
  onExit: () => void;
  onForceOk: () => void;
  onBulkComplete: () => void;
  busy: boolean;
  portrait: boolean;
}) {
  // U-4: 縦向きでも 1 行 6 ボタン構成にして上部の商品リストを広く確保
  return (
    <footer
      style={{
        height: portrait ? 56 : 82,
        display: 'flex',
        gap: portrait ? 4 : 7,
        padding: portrait ? '4px 0 0' : '8px 0 0',
        flexShrink: 0,
        marginTop: 8,
      }}
    >
      {/* F1 商品スキャン (青) */}
      <FooterButton
        Icon={BarcodeIcon}
        label="商品スキャン"
        kb="F1"
        bg="#2563eb"
        portrait={portrait}
        highlight={false}
        disabled={busy}
      />
      {/* F2 強制OK (オレンジ) */}
      <FooterButton
        Icon={ShieldCheckIcon}
        label="強制OK"
        kb="F2"
        bg="#ea580c"
        portrait={portrait}
        onClick={onForceOk}
        disabled={busy || allInspected}
      />
      {/* F3 同梱物ON (グレー) */}
      <FooterButton
        Icon={BoxIcon}
        label="同梱物ON"
        kb="F3"
        bg="#475569"
        portrait={portrait}
        disabled={busy}
      />
      {/* F4 一括検品 (緑) — allInspected 時はモーダル再オープン（脈動） */}
      <FooterButton
        Icon={ClipboardCheckIcon}
        label={allInspected ? '最終チェック' : '一括検品'}
        kb="F4"
        bg="#059669"
        portrait={portrait}
        onClick={onBulkComplete}
        highlight={allInspected}
        disabled={busy}
      />
      {/* F5 伝票保留 (赤) */}
      <FooterButton
        Icon={BookmarkIcon}
        label="伝票保留"
        kb="F5"
        bg="#dc2626"
        portrait={portrait}
        onClick={onHold}
        disabled={busy}
      />
      {/* ESC 中断 (グレー) */}
      <FooterButton
        Icon={ArrowLeftIcon}
        label="中断"
        kb="ESC"
        bg="#475569"
        portrait={portrait}
        onClick={onExit}
        disabled={busy}
      />
    </footer>
  );
}

interface FooterIconProps {
  size?: number;
  width?: number;
  height?: number;
}

function FooterButton({
  Icon,
  label,
  kb,
  bg,
  portrait,
  onClick,
  disabled,
  highlight,
}: {
  Icon: React.ComponentType<FooterIconProps>;
  label: string;
  kb: string;
  bg: string;
  portrait: boolean;
  onClick?: () => void;
  disabled?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-center justify-center transition-all',
        'active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed',
        'hover:brightness-110',
        highlight && 'animate-tablet-hilite',
      )}
      style={{
        flex: 1,
        height: '100%',
        borderRadius: 8,
        background: bg,
        color: '#fff',
        fontWeight: 'bold',
        gap: 1,
        border: '2px solid transparent',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        padding: portrait ? '0 2px' : 0,
        minWidth: 0,
      }}
    >
      <span style={{ display: 'inline-flex' }}>
        <Icon size={portrait ? 16 : 22} />
      </span>
      <span style={{ fontSize: portrait ? 10 : 14 }}>{label}</span>
      {!portrait && (
        <span
          style={{
            fontSize: 9,
            color: 'rgba(255,255,255,0.8)',
            fontWeight: 'normal',
            letterSpacing: 1,
          }}
        >
          {kb}
        </span>
      )}
    </button>
  );
}
