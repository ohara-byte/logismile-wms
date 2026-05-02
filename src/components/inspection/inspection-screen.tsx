'use client';

/**
 * 検品メイン画面（タブレット / ハンディ共通）
 *
 * - 連絡事項モーダル（モバイル端末で起動時に1回）
 * - のし確認モーダル（qrPrintFlag=true の伝票で開始時）
 * - 同梱物確認モーダル（完了直前）
 * - 商品スキャン（JAN または 商品コード）
 * - 強制OK / 保留
 * - QR印刷フラグ手動切替
 * - 箱選定（提案 + ドロップダウン）
 * - 縦表示トグル
 * - 完了（納品書№スキャン → packed + 自動印刷）
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NoticesModal } from './notices-modal';
import { NoshiConfirmationModal } from './noshi-confirmation-modal';
import { AccompaniesModal } from './accompanies-modal';
import { BoxSuggestion } from './box-suggestion';

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
  /** 端末バリアント。UI 密度・モーダルの出し方を切り替え。 */
  variant: 'tablet' | 'handy';
}

type ScanResult = 'matched' | 'over_scan' | 'not_found' | 'already_done';

export function InspectionScreen({ order: initialOrder, employee, variant }: Props) {
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

  // モーダル制御
  const [showNotices, setShowNotices] = useState(variant === 'handy'); // ハンディ起動時のみ
  const [showNoshi, setShowNoshi] = useState(false);
  const [showAccompanies, setShowAccompanies] = useState(false);
  const [accompaniesConfirmed, setAccompaniesConfirmed] = useState(false);

  // 縦/横レイアウト
  const [portrait, setPortrait] = useState(variant === 'handy'); // ハンディは既定で縦

  const scanInputRef = useRef<HTMLInputElement>(null);
  const invoiceInputRef = useRef<HTMLInputElement>(null);

  // 連絡事項クローズ後にのし確認を出す
  useEffect(() => {
    if (showNotices) return;
    if (!sessionId) return; // セッション開始前にはのし表示しない
    if (order.qrPrintFlag && !showNoshi && !accompaniesConfirmed) {
      // のし確認はセッション開始直後に1回だけ
      // sessionId が立った直後に発火させる
    }
  }, [showNotices, sessionId, order.qrPrintFlag, showNoshi, accompaniesConfirmed]);

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
          // qrPrintFlag=true ならのし確認モーダルを出す
          if (order.qrPrintFlag) setShowNoshi(true);
        } else setErrorMsg(j.message ?? 'セッション開始に失敗');
      })
      .catch((e) => setErrorMsg(String(e)));
  }, [order.pkNo, order.qrPrintFlag, sessionId, completed]);

  // スキャン入力フォーカス（モーダルが閉じたら）
  useEffect(() => {
    if (!showNotices && !showNoshi && !showAccompanies) {
      scanInputRef.current?.focus();
    }
  }, [showNotices, showNoshi, showAccompanies]);

  const allInspected = order.items.every((it) => it.forceOk || it.scannedQty >= it.qty);

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
    if (!scanInput.trim() || !sessionId) return;
    setBusy(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/inspect/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, scanValue: scanInput.trim(), qty: 1 }),
      });
      const j = await res.json();
      if (!res.ok) setErrorMsg(j.message ?? `エラー: HTTP ${res.status}`);
      else {
        setLastResult(j.data);
        if (j.data.result === 'matched') await refreshOrder();
      }
    } finally {
      setBusy(false);
      setScanInput('');
      scanInputRef.current?.focus();
    }
  }

  async function onForceOk(item: InspectionItem) {
    const reason = prompt(`「${item.productName}」を強制OKにする理由を入力してください`);
    if (!reason || !sessionId) return;
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

  async function onCompleteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceNo.trim() || !sessionId) return;

    // 同梱物未確認なら先にモーダル
    if (!accompaniesConfirmed) {
      setShowAccompanies(true);
      return;
    }

    await actuallyComplete();
  }

  async function actuallyComplete() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/inspect/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          pkNo: order.pkNo,
          invoiceNo: invoiceNo.trim(),
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

  async function onHold() {
    const reason = prompt('保留理由を入力してください');
    if (!reason || !sessionId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/inspect/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, reason }),
      });
      if (res.ok) router.push(variant === 'tablet' ? '/tablet' : '/handy');
      else setErrorMsg((await res.json()).message ?? '保留失敗');
    } finally {
      setBusy(false);
    }
  }

  // === 完了画面 ===
  if (completed) {
    return (
      <main className="min-h-screen bg-green-50 p-4 sm:p-6">
        <div className="max-w-md mx-auto bg-white rounded-xl shadow-md p-6 text-center">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-green-700 mb-2">梱包完了</h1>
          <p className="text-gray-600 mb-6">
            ピッキング№ <code className="font-mono">{order.pkNo}</code>
          </p>
          <dl className="text-left bg-gray-50 rounded p-4 grid grid-cols-2 gap-2 text-sm mb-6">
            <dt className="text-gray-500">所要時間</dt>
            <dd>{completionInfo?.durationSec ?? '—'} 秒</dd>
            <dt className="text-gray-500">QR印刷フラグ</dt>
            <dd>{completionInfo?.qrPrintFlag ? 'ON' : 'OFF'}</dd>
            <dt className="text-gray-500">印刷</dt>
            <dd>
              {completionInfo?.print
                ? `${completionInfo.print.ok ? '送信済' : '失敗'}${completionInfo.print.dryRun ? '（DRY-RUN）' : ''}`
                : '—'}
            </dd>
          </dl>
          <button
            onClick={() => router.push(variant === 'tablet' ? '/tablet' : '/handy')}
            className="w-full bg-blue-600 text-white rounded-lg py-4 text-lg font-medium hover:bg-blue-700"
          >
            次の伝票へ
          </button>
        </div>
      </main>
    );
  }

  // === メイン UI ===
  const compact = variant === 'handy' || portrait;
  const containerMaxW = compact ? 'max-w-md' : 'max-w-3xl';
  const itemPad = compact ? 'p-2' : 'p-3';
  const fontSize = compact ? 'text-sm' : 'text-base';

  return (
    <main className={`min-h-screen bg-gray-50 ${compact ? 'p-2' : 'p-4'}`}>
      {/* モーダル */}
      {showNotices && (
        <NoticesModal
          variant={variant === 'tablet' ? 'tablet-launch' : 'handy-launch'}
          onClose={() => setShowNotices(false)}
        />
      )}
      {showNoshi && (
        <NoshiConfirmationModal
          pkNo={order.pkNo}
          noshiName={order.noshiName}
          qrPrintFlag={order.qrPrintFlag}
          onConfirm={() => setShowNoshi(false)}
          onCancel={() => router.push(variant === 'tablet' ? '/tablet' : '/handy')}
        />
      )}
      {showAccompanies && (
        <AccompaniesModal
          pkNo={order.pkNo}
          onConfirm={() => {
            setAccompaniesConfirmed(true);
            setShowAccompanies(false);
            // 自動で完了処理を続行
            actuallyComplete();
          }}
          onCancel={() => setShowAccompanies(false)}
        />
      )}

      <div className={`${containerMaxW} mx-auto space-y-3`}>
        {/* ヘッダ */}
        <div className={`bg-white rounded-xl shadow ${itemPad} ${fontSize}`}>
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="text-xs text-gray-500">ピッキング№</div>
              <div className={`${compact ? 'text-base' : 'text-xl'} font-mono font-bold`}>
                {order.pkNo}
              </div>
            </div>
            <div className="flex gap-2">
              {variant === 'tablet' && (
                <button
                  onClick={() => setPortrait((p) => !p)}
                  className="text-xs text-gray-500 hover:underline"
                  title="縦横切替"
                >
                  {portrait ? '◫ 横' : '▯ 縦'}
                </button>
              )}
              <button
                onClick={() => router.push(variant === 'tablet' ? '/tablet' : '/handy')}
                className="text-xs text-gray-500 hover:underline"
              >
                ← 戻る
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-700">
            <div>運送: {order.carrier?.short ?? order.carrier?.name ?? '—'}</div>
            <div>状態: {order.status}</div>
            <div className="col-span-2 truncate">
              {order.destName ?? '—'} / {order.destZip} {order.destAddr}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs">QR印刷フラグ:</span>
            <button
              onClick={onTogglePrintFlag}
              disabled={busy}
              className={`px-3 py-1 rounded text-xs font-medium ${
                order.qrPrintFlag
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700'
              }`}
            >
              {order.qrPrintFlag ? '🖨 ON' : '○ OFF'}
            </button>
          </div>
        </div>

        {/* スキャン入力 */}
        <div className={`bg-white rounded-xl shadow ${itemPad}`}>
          <form onSubmit={onScan} className="flex gap-2">
            <input
              ref={scanInputRef}
              type="text"
              autoFocus
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              className={`flex-1 border-2 rounded-lg px-3 ${
                compact ? 'py-2 text-base' : 'py-3 text-lg'
              } font-mono`}
              placeholder="JAN/商品コード"
            />
            <button
              type="submit"
              disabled={busy || !scanInput.trim() || !sessionId}
              className={`${compact ? 'px-4' : 'px-6'} bg-blue-600 text-white rounded-lg font-medium disabled:bg-gray-300`}
            >
              スキャン
            </button>
          </form>
          {lastResult && (
            <div
              className={`mt-2 p-2 rounded text-xs ${
                lastResult.result === 'matched'
                  ? 'bg-green-50 text-green-800'
                  : lastResult.result === 'already_done'
                    ? 'bg-gray-100 text-gray-700'
                    : 'bg-red-50 text-red-700'
              }`}
            >
              直近: <strong>{lastResult.result}</strong>
            </div>
          )}
          {errorMsg && (
            <div className="mt-2 p-2 rounded text-xs bg-red-50 text-red-700">{errorMsg}</div>
          )}
        </div>

        {/* 商品リスト */}
        <div className={`bg-white rounded-xl shadow ${itemPad}`}>
          <h2 className="font-semibold mb-2 text-sm">商品 ({order.items.length})</h2>
          <ul className="space-y-2">
            {order.items.map((it) => {
              const done = it.forceOk || it.scannedQty >= it.qty;
              return (
                <li
                  key={it.id}
                  className={`border rounded ${itemPad} flex items-center gap-2 ${
                    done ? 'bg-green-50 border-green-200' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {it.productName}
                      {it.productFrozen && (
                        <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1 rounded">
                          冷
                        </span>
                      )}
                      {it.forceOk && (
                        <span className="ml-1 text-xs bg-yellow-100 text-yellow-800 px-1 rounded">
                          強制
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {it.productCode}
                      {it.productJan ? ` / ${it.productJan}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`${compact ? 'text-base' : 'text-lg'} font-bold ${
                        done ? 'text-green-700' : 'text-gray-700'
                      }`}
                    >
                      {it.scannedQty}/{it.qty}
                    </div>
                    {!done && (
                      <button
                        onClick={() => onForceOk(it)}
                        disabled={busy}
                        className="text-xs text-yellow-700 hover:underline disabled:text-gray-300"
                      >
                        強制OK
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* 箱選定 */}
        <div className={`bg-white rounded-xl shadow ${itemPad}`}>
          <BoxSuggestion
            pkNo={order.pkNo}
            selectedBoxCode={boxCode}
            onSelect={setBoxCode}
            density={compact ? 'compact' : 'wide'}
          />
        </div>

        {/* 完了 */}
        <div className={`bg-white rounded-xl shadow ${itemPad}`}>
          <h2 className="font-semibold mb-2 text-sm">納品書№ で完了</h2>
          <form onSubmit={onCompleteSubmit} className="flex gap-2 mb-2">
            <input
              ref={invoiceInputRef}
              type="text"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              className={`flex-1 border-2 rounded-lg px-3 ${
                compact ? 'py-2 text-base' : 'py-3 text-lg'
              } font-mono`}
              placeholder="00059546010001"
              disabled={!allInspected || busy}
            />
            <button
              type="submit"
              disabled={!allInspected || busy || !invoiceNo.trim()}
              className={`${compact ? 'px-4' : 'px-6'} bg-green-600 text-white rounded-lg font-medium disabled:bg-gray-300`}
            >
              完了
            </button>
          </form>
          {!allInspected && (
            <p className="text-xs text-gray-500">
              すべての商品を検品 or 強制OK で押せます
            </p>
          )}
          <div className="mt-2 text-right">
            <button
              onClick={onHold}
              disabled={busy}
              className="text-xs text-orange-600 hover:underline"
            >
              一時保留
            </button>
          </div>
        </div>

        <div className="text-center text-xs text-gray-400">
          {employee?.name}（{employee?.empCode}） / {employee?.deviceCode}
        </div>
      </div>
    </main>
  );
}
