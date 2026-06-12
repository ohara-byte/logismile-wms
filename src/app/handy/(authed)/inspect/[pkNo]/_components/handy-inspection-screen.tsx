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
import { FinalCheckModal } from '@/components/inspection/final-check-modal';
import { PrintConfirmModal } from '@/components/inspection/print-confirm-modal';
import { ForceOkModal } from '@/components/inspection/force-ok-modal';
import { QtyKeypadModal } from '@/components/inspection/qty-keypad-modal';
import { HoldMenuModal } from '@/components/inspection/hold-menu-modal';
import { HoldContactModal } from '@/components/inspection/hold-contact-modal';
import { ReprintModal } from '@/components/inspection/reprint-modal';
import { useStickyForceOk } from '@/lib/use-sticky-force-ok';
import { useHardwareKeys } from '@/lib/use-hardware-keys';
import { useScanSound } from '@/lib/use-scan-sound';
import { SoundToggle } from '@/components/inspection/sound-toggle';

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

/**
 * 検品済（強制OK / 数量到達）行を末尾に並べ替えて返す。
 *   - ユーザー要望（2026-05-20）: 点数多い伝票で未検品の見切れを防ぐため
 *   - 安定ソート（同状態内は元の id 順を保持）
 *   - 表示順とキーボード選択順を一致させるため、両方で同じ並びを使う
 */
function sortInspectionItems(items: InspectionItem[]): InspectionItem[] {
  return [...items].sort((a, b) => {
    const aDone = a.forceOk || a.scannedQty >= a.qty;
    const bDone = b.forceOk || b.scannedQty >= b.qty;
    if (aDone !== bDone) return aDone ? 1 : -1;
    return a.id - b.id;
  });
}

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

  // フラッシュアニメ
  const [flash, setFlash] = useState<FlashColor>(null);

  // モーダル制御
  // ※ 連絡事項は idle 画面で既に表示済みのため、検品画面では既定 false。
  //    F1 押下時のみ再表示する（モック L2725-2728 の挙動相当）。
  const [showNotices, setShowNotices] = useState(false);
  const [showFinalCheck, setShowFinalCheck] = useState(false);
  const [forceTarget, setForceTarget] = useState<InspectionItem | null>(null);
  const [qtyTarget, setQtyTarget] = useState<InspectionItem | null>(null);
  const [holdMenuOpen, setHoldMenuOpen] = useState(false);
  const [holdContactOpen, setHoldContactOpen] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);

  // 選択行（Up/Down で移動、Enter or Trigger で +1 スキャン）
  const [selectedRow, setSelectedRow] = useState<number>(-1);

  // Sprint Y-14: ハンディの数字キーで keypad を開いた時の初期入力値（0-9 のいずれか）
  const [qtyInitialDigit, setQtyInitialDigit] = useState<number | null>(null);

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
  // 自動展開の二重発火防止（D-1, モック L2167 と同等）
  const autoExpandedThisLoad = useRef(false);

  const allInspected = order.items.every((it) => it.forceOk || it.scannedQty >= it.qty);

  const anyModalOpen =
    showNotices ||
    showFinalCheck ||
    forceTarget !== null ||
    qtyTarget !== null ||
    holdMenuOpen ||
    holdContactOpen ||
    reprintOpen;

  const triggerFlash = useCallback((color: FlashColor) => {
    setFlash(color);
    setTimeout(() => setFlash(null), 500);
  }, []);

  // セッション開始（D-2: 起動時 NoshiConfirmation 撤廃）
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

  // モーダル閉じたらフォーカス回復
  useEffect(() => {
    if (!showNotices && !showFinalCheck) {
      scanInputRef.current?.focus();
    }
  }, [showNotices, showFinalCheck]);

  // D-1: 商品検品完了で最終チェックモーダルを自動展開
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
      const id = setTimeout(() => setShowFinalCheck(true), 350);
      return () => clearTimeout(id);
    }
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

  // 商品スキャンのみ。納品書は最終チェックモーダル内で処理（D-1）
  async function onScan(e: React.FormEvent) {
    e.preventDefault();
    const value = scanInput.trim();
    if (!value || !sessionId) return;

    // 数量プレフィックス機能は **ピッキング中（商品検品中）のみ** 有効化。
    //   - 全件完了後（allInspected=true）は納品書スキャンなので、qty-prefix は適用しない。
    //   - 納品書スキャンは最終チェックモーダル内のハンドラで処理される。
    if (!allInspected) {
      // ──────────────────────────────────────────────────
      // パターン①：1〜3 桁の数字のみ → 選択行への数量入力（既存挙動）
      //   現場で数量だけ加算したいとき（スキャンなし）
      // ──────────────────────────────────────────────────
      if (/^\d{1,3}$/.test(value)) {
        const qty = parseInt(value, 10);
        const sorted = sortInspectionItems(order.items);
        const target =
          selectedRow >= 0 && sorted[selectedRow]
            ? sorted[selectedRow]
            : sorted.find((it) => !it.forceOk && it.scannedQty < it.qty);
        if (target && qty > 0) {
          setScanInput('');
          setErrorMsg(null);
          try {
            await applyManualQty(target, qty);
          } catch {
            /* applyManualQty 内で setErrorMsg / フラッシュ済 */
          } finally {
            scanInputRef.current?.focus();
          }
          return;
        }
        // 対象なし or 0 の場合は通常のスキャン処理へフォールバック
      }

      // ──────────────────────────────────────────────────
      // パターン②：「数字プレフィックス + バーコード」自動分離
      //   2026-05-20 ユーザー要望：機能キーで数字を先入力 → そのままスキャンで
      //   その数量がスキャン対象に加算される（Enter 押下不要、業務効率 UP）。
      //
      //   仕組み：
      //     a. まず入力全体を JAN/商品コードとして検索
      //     b. ヒットしなければ、先頭 1〜3 桁を数量と仮定し、残りを JAN/商品コードとして再検索
      //     c. ヒットした qty で applyManualQty を呼ぶ（API は 1 回のみ）
      // ──────────────────────────────────────────────────
      const findItem = (code: string) =>
        order.items.find(
          (it) => it.productCode === code || it.productJan === code,
        );

      // (a) 入力全体が JAN / 商品コード一致 → qty=1 でスキャン
      let matchedItem = findItem(value);
      let prefixQty = 1;

      // (b) ヒットなし → 先頭 1〜3 桁を数量プレフィックスとして再試行
      if (!matchedItem && /^\d/.test(value)) {
        for (const plen of [1, 2, 3]) {
          if (value.length < plen + 4) break; // 残りが短すぎ（最低 4 桁は欲しい）
          const prefix = value.slice(0, plen);
          if (!/^\d+$/.test(prefix)) break;
          const rest = value.slice(plen);
          const found = findItem(rest);
          if (found) {
            matchedItem = found;
            prefixQty = parseInt(prefix, 10);
            break;
          }
        }
      }

      if (matchedItem && prefixQty > 0) {
        setScanInput('');
        setErrorMsg(null);
        try {
          await applyManualQty(matchedItem, prefixQty);
        } catch {
          /* applyManualQty 内で setErrorMsg 済 */
        } finally {
          scanInputRef.current?.focus();
        }
        return;
      }
    }

    // ──────────────────────────────────────────────────
    // パターン③：上記いずれにも該当しない → 従来通り API スキャン
    //   (新規商品 / 未登録 JAN のチェックなど、サーバ側のロジックに委ねる)
    // ──────────────────────────────────────────────────
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
   *   伝票全体の再取得（refreshOrder）を避ける。欠落時のみ全体再取得にフォールバック。
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

  async function actuallyComplete(invoiceValue: string) {
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
          // 2026-06-03 ②: 完了と印刷を分離。ここでは印刷せず完了し、印刷は完了画面後の確認で。
          skipPrint: true,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErrorMsg(j.message ?? '完了処理失敗');
        playError();
        return;
      }
      setShowFinalCheck(false);
      setCompleted(true);
      // 検品完了：達成感ある上昇アルペジオ
      playSuccess();
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

  // 選択行を上下に移動（sortInspectionItems の並びで巡回）
  function moveSelectedRow(delta: 1 | -1) {
    const itemsArr = sortInspectionItems(order.items);
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
    const sorted = sortInspectionItems(order.items);
    const it =
      selectedRow >= 0 && sorted[selectedRow]
        ? sorted[selectedRow]
        : sorted.find((x) => !x.forceOk && x.scannedQty < x.qty);
    if (!it) return;
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
        playError();
      } else {
        setLastResult(j.data);
        if (j.data.result === 'matched') {
          triggerFlash('green');
          playBeep();
          applyScannedQtyLocal(j.data.itemId, j.data.scannedQty);
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

  // F4 一括検品: 残全件を強制OK 扱いで完了させる（モック skipAndFinish 準拠）
  // 既に全件完了している場合は最終チェックモーダルを再オープン（モック L2335-2342 準拠）
  async function onBulkComplete() {
    if (!sessionId) return;
    if (allInspected) {
      autoExpandedThisLoad.current = true; // 再オープンを許容
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
      // Sprint Y-15: 並列実行 + 失敗集約
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
        setErrorMsg(
          `一括検品: ${failed} 件の処理に失敗しました（成功 ${results.length - failed} 件）`,
        );
      }
      await refreshOrder();
    } finally {
      setBusy(false);
    }
  }

  // ハードウェアキー（A-18 / モック L2651-2767 hwKey 準拠）
  // - F1〜F4 はモーダル開いていても発火（モック仕様: F は常時有効。anyModalOpen でガードしない）
  //   ただしモック側は anyModalOpen 中は F1-F4 を return しているので、ここでも安全側で同様に。
  // - 数字キー: 検品画面で押すと QtyKeypadModal を即オープン（モック L2654-2666）
  useHardwareKeys({
    enabled: !anyModalOpen,
    onF1: () => setShowNotices(true),
    onF2: () => {
      const sorted = sortInspectionItems(order.items);
      const target =
        selectedRow >= 0 && sorted[selectedRow]
          ? sorted[selectedRow]
          : sorted.find((it) => !it.forceOk && it.scannedQty < it.qty);
      if (target) onForceOk(target);
    },
    onF3: () => {
      // F3 = 数量入力モーダル起動（2026-05-18 ユーザー要望）
      //   選択行（なければ先頭の未完了行）の QtyKeypadModal を開く。
      const sorted = sortInspectionItems(order.items);
      const target =
        selectedRow >= 0 &&
        sorted[selectedRow] &&
        sorted[selectedRow].scannedQty < sorted[selectedRow].qty
          ? sorted[selectedRow]
          : sorted.find((it) => !it.forceOk && it.scannedQty < it.qty);
      if (!target) return;
      setQtyInitialDigit(null);
      setQtyTarget(target);
    },
    onF4: () => {
      onBulkComplete();
    },
    onUp: () => moveSelectedRow(-1),
    onDown: () => moveSelectedRow(1),
    onTab: () => moveSelectedRow(1),
    onEnter: () => onTriggerScan(),
    onTrigger: () => onTriggerScan(),
    onEscape: () => setHoldMenuOpen(true),
    onDigit: (d: number) => {
      // モック準拠: 数字キー押下 → 選択行（または先頭未完了行）の数量キーパッドをオープン
      // Sprint Y-14: トリガーとなった数字を初期値として keypad に渡す（初手入力消失バグ修正）
      const sorted = sortInspectionItems(order.items);
      const target =
        selectedRow >= 0 &&
        sorted[selectedRow] &&
        sorted[selectedRow].scannedQty < sorted[selectedRow].qty
          ? sorted[selectedRow]
          : sorted.find((it) => !it.forceOk && it.scannedQty < it.qty);
      if (!target) return;
      setQtyInitialDigit(d);
      setQtyTarget(target);
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
  // モック L1104-1111 .complete-screen 準拠（ハンディ版）
  // - 完了サマリ表示 + 「次の伝票をスキャンしてください」
  // - 3.5 秒で /handy へ自動遷移（モック L2665 と同じタイミング）
  // - 不可視 input でスキャナ Enter を受け取り即遷移
  if (completed) {
    return (
      <HandyCompleteScreen order={order} completionInfo={completionInfo} />
    );
  }

  // === メイン画面 ===
  const totalQty = order.items.reduce((s, i) => s + i.qty, 0);
  const scannedQty = order.items.reduce(
    (s, i) => s + (i.forceOk ? i.qty : i.scannedQty),
    0,
  );

  // selectedRow / 上下キー / F2 / F3 / 数字キー の対象は sortInspectionItems() の
  // 並び順を基準とする（ScanLine 描画と同じ順序）。
  const sortedItems = sortInspectionItems(order.items);

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
      <FinalCheckModal
        open={showFinalCheck}
        variant="handy"
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
        onConfirm={async (invoiceNo) => {
          await actuallyComplete(invoiceNo);
        }}
        onBack={() => {
          // ★戻るで閉じたあとは自動再展開させない（autoExpandedThisLoad は true のまま）
          //   再度開きたい場合は F4 または「一括検品」ボタンを押下する。
          setShowFinalCheck(false);
        }}
      />
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
        initialDigit={qtyInitialDigit ?? undefined}
        onConfirm={async (n) => {
          if (qtyTarget) await applyManualQty(qtyTarget, n);
          setQtyTarget(null);
          setQtyInitialDigit(null);
        }}
        onCancel={() => {
          setQtyTarget(null);
          setQtyInitialDigit(null);
        }}
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
        invoiceNo={order.invoiceNo}
        customerCode={order.customerCode}
        customerName={order.destName}
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
        {/* 検品スキャン音 ON/OFF（2026-05-23 追加） */}
        <SoundToggle
          enabled={soundEnabled}
          onToggle={() => setSoundEnabled(!soundEnabled)}
          variant="handy"
        />
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

      {/* 商品リスト — sortedItems を使用（検品済を最下段に） */}
      <div className="flex-1 overflow-auto px-1.5 py-1.5 space-y-1">
        {sortedItems.map((it, idx) => (
          <ScanLine
            key={it.id}
            item={it}
            isLast={lastResult?.itemId === it.id}
            lastResult={lastResult}
            onOpenKeypad={(item) => setQtyTarget(item)}
            isSelected={selectedRow === idx}
          />
        ))}
        {sortedItems.length === 0 && (
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
            // モック準拠：日本語ラベルなので uppercase / tracking-wider は外す
            'block text-3xs font-bold mb-1',
            allInspected ? 'text-cyan-300 animate-pulse' : 'text-accent-amber',
          )}
        >
          {allInspected
            ? '👉 納品書№ をスキャン'
            : 'ピッキング：数量＋スキャン（例：5 → 即スキャン）'}
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

      {/* フッタ操作（Sprint F-4: モック L1383-1389 / L1466-1469 に合わせ F1〜F4 + Esc の 5 ボタン構成）
          モック準拠：footer 高さ 62px（タップしやすさ確保） */}
      <footer className="bg-surface-panel border-t border-surface-border h-[62px] grid grid-cols-5 gap-1 p-1 shrink-0">
        <HandyFkeyBtn
          label="連絡"
          sub="F1"
          tone="amber"
          disabled={busy}
          onClick={() => setShowNotices(true)}
        />
        <HandyFkeyBtn
          label="強制OK"
          sub="F2"
          tone="orange"
          disabled={busy || allInspected}
          onClick={() => {
            const target =
              selectedRow >= 0 && sortedItems[selectedRow]
                ? sortedItems[selectedRow]
                : sortedItems.find(
                    (it) => !it.forceOk && it.scannedQty < it.qty,
                  );
            if (target) onForceOk(target);
          }}
        />
        <HandyFkeyBtn
          label="数量"
          sub="F3"
          tone="slate"
          disabled={busy || allInspected}
          onClick={() => {
            // F3 = 数量入力モーダル起動（選択行 or 先頭未完了行）
            const target =
              selectedRow >= 0 &&
              sortedItems[selectedRow] &&
              sortedItems[selectedRow].scannedQty < sortedItems[selectedRow].qty
                ? sortedItems[selectedRow]
                : sortedItems.find(
                    (it) => !it.forceOk && it.scannedQty < it.qty,
                  );
            if (!target) return;
            setQtyInitialDigit(null);
            setQtyTarget(target);
          }}
        />
        <HandyFkeyBtn
          label={allInspected ? '最終チェック' : '一括検品'}
          sub="F4"
          tone="emerald"
          disabled={busy}
          highlight={allInspected}
          onClick={() => onBulkComplete()}
        />
        <HandyFkeyBtn
          label="保留"
          sub="Esc"
          tone="red"
          disabled={busy}
          onClick={onHold}
        />
      </footer>
    </main>
  );
}

/**
 * scan-line — ユーザー要望（2026-05-18）でシンプル化：
 *   row1: 商品名 + バッジ（フォント +3px）
 *   row2: 数量表示 + 🔢数量入力ボタン
 *   ※ 商品コード/JAN 行は廃止（現場で目視確認に不要）
 * ※ 強制OK は機能キー F2 で対応するため、行内ボタンは出さない
 */
function ScanLine({
  item,
  isLast,
  lastResult,
  onOpenKeypad,
  isSelected,
}: {
  item: InspectionItem;
  isLast: boolean;
  lastResult: { result: ScanResult; itemId: number | null } | null;
  onOpenKeypad: (i: InspectionItem) => void;
  isSelected?: boolean;
}) {
  const done = item.forceOk || item.scannedQty >= item.qty;
  const warn = isLast && lastResult?.result === 'over_scan';

  return (
    <div
      style={{
        background: warn
          ? '#450a0a'
          : done
            ? '#064e3b'
            : isSelected
              ? '#422006'
              : '#1e293b',
        borderLeft: `4px solid ${
          warn
            ? '#ef4444'
            : done
              ? '#10b981'
              : isSelected
                ? '#fbbf24'
                : '#64748b'
        }`,
        boxShadow: isSelected ? '0 0 0 1px #fbbf24' : undefined,
        borderRadius: 6,
        padding: '10px 12px',
        transition: 'all 0.15s',
      }}
      className={warn ? 'animate-tablet-shake' : ''}
    >
      {/* row1: 商品名 + バッジ — フォントを +3px に拡大（13→16） */}
      <div
        style={{
          fontSize: 16,
          fontWeight: 'bold',
          color: '#f1f5f9',
          marginBottom: 6,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          minWidth: 0,
          lineHeight: 1.2,
        }}
      >
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.productName}
        </span>
        {item.productFrozen && (
          <span className="text-2xs bg-frozen-bg text-frozen-light px-1 rounded shrink-0">
            冷
          </span>
        )}
        {item.forceOk && (
          <span className="text-2xs bg-status-warn-bg text-accent-amber px-1 rounded shrink-0">
            強
          </span>
        )}
      </div>
      {/* row2: 数量表示 + 🔢 数量入力 — フォントを +3px に拡大（16→19 / 11→14） */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontSize: 19,
            fontWeight: 'bold',
            fontVariantNumeric: 'tabular-nums',
            color: done ? '#6ee7b7' : isSelected ? '#fbbf24' : '#f1f5f9',
          }}
        >
          {item.scannedQty}
          <span style={{ fontSize: 14, color: '#94a3b8', margin: '0 4px', fontWeight: 'normal' }}>
            /
          </span>
          {item.qty}
          <span style={{ fontSize: 14, color: '#94a3b8', marginLeft: 4, fontWeight: 'normal' }}>
            点
          </span>
        </div>
        {!done && (
          <button
            onClick={() => onOpenKeypad(item)}
            title="数量入力（残数を加算）"
            style={{
              background: '#4338ca',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: 4,
              fontSize: 14,
              fontWeight: 'bold',
              border: '1px solid #6366f1',
            }}
            className="hover:brightness-110 active:scale-95"
          >
            🔢 数量
          </button>
        )}
      </div>
    </div>
  );
}

function HandyFkeyBtn({
  label,
  sub,
  tone,
  disabled,
  onClick,
  highlight,
}: {
  label: string;
  sub: string;
  tone: 'amber' | 'orange' | 'slate' | 'emerald' | 'red';
  disabled?: boolean;
  onClick?: () => void;
  highlight?: boolean;
}) {
  const toneCls: Record<typeof tone, string> = {
    amber: 'bg-amber-700 hover:bg-amber-600 border-amber-500',
    orange: 'bg-orange-700 hover:bg-orange-600 border-orange-500',
    slate: 'bg-slate-700 hover:bg-slate-600 border-slate-500',
    emerald: 'bg-emerald-700 hover:bg-emerald-600 border-emerald-500',
    red: 'bg-red-700 hover:bg-red-600 border-red-500',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded border text-white text-2xs font-bold flex flex-col items-center justify-center leading-tight px-1 active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed',
        toneCls[tone],
        highlight && 'animate-tablet-hilite',
      )}
    >
      <span>{label}</span>
      <span className="text-[8px] opacity-70 font-normal">{sub}</span>
    </button>
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

/* ====== 完了画面（モック L1104-1111 .complete-screen 準拠 + 自動遷移） ====== */
function HandyCompleteScreen({
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
  // 2026-06-03 ②: 完了後、QR印刷フラグ ON なら自動で印刷確認を表示（表示中は自動遷移・次スキャン抑止）
  const [showPrint, setShowPrint] = useState(completionInfo?.qrPrintFlag === true);
  const [printing, setPrinting] = useState(false);

  // 不可視 input にフォーカス維持
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    requestAnimationFrame(focus);
    const t1 = setTimeout(focus, 50);
    const t2 = setTimeout(focus, 200);
    const t3 = setTimeout(focus, 500);
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

  // モック L2665 準拠: 3.5 秒で /handy へ自動遷移
  //   2026-06-03 ②: 印刷確認モーダル表示中は自動遷移を抑止。
  useEffect(() => {
    if (navigating || showPrint) return;
    const id = setTimeout(() => {
      if (!navigating) router.push('/handy');
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
      router.push('/handy');
    }
  }

  // グローバルキー捕捉（万一 input にフォーカスが奪われていても受ける）
  useEffect(() => {
    let buffer = '';
    let lastKeyAt = 0;
    function onKey(e: KeyboardEvent) {
      if (navigating || showPrint) return; // 印刷確認中は次スキャン抑止
      if (document.activeElement === inputRef.current) return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
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
      if (e.key.length === 1) buffer += e.key;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, showPrint]);

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
      if (status === 'held' || status === 'packed' || status === 'shipped') {
        router.push(`/handy?pkNo=${encodeURIComponent(nextPkNo)}`);
        return;
      }
      router.push(`/handy/inspect/${encodeURIComponent(nextPkNo)}`);
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

  return (
    <>
    <main
      className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
      style={{
        background: 'linear-gradient(135deg, #065f46, #047857)',
        color: '#fff',
        gap: 12,
      }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* 不可視 input — HID スキャナ Enter 受信用 */}
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

      <div
        style={{
          fontSize: 110,
          color: '#fff',
          filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.3))',
          lineHeight: 1,
        }}
      >
        ✓
      </div>
      <h1 style={{ fontSize: 28, color: '#fff', fontWeight: 'bold', margin: 0 }}>
        梱包完了
      </h1>
      <p
        style={{
          fontSize: 13,
          color: '#a7f3d0',
          margin: 0,
          fontFamily: 'Consolas, monospace',
          letterSpacing: 1,
        }}
      >
        {order.pkNo}
      </p>
      {completionInfo && (
        <p style={{ fontSize: 12, color: '#d1fae5', margin: 0 }}>
          所要 {completionInfo.durationSec} 秒
          {completionInfo.qrPrintFlag
            ? completionInfo.print
              ? ` ・ QR ${completionInfo.print.ok ? '送信済' : '失敗'}${completionInfo.print.dryRun ? '*' : ''}`
              : ' ・ QR フラグ ON'
            : ' ・ QR なし'}
        </p>
      )}
      <p
        style={{ fontSize: 12, color: '#a7f3d0', margin: 0 }}
        className="animate-pulse"
      >
        次の伝票をスキャンしてください
      </p>
      {errorMsg && (
        <div
          style={{
            background: 'rgba(127, 29, 29, 0.7)',
            color: '#fecaca',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 12,
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
