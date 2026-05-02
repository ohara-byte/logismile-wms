'use client';

/**
 * 検品メイン画面（Client Component）
 *
 * - 商品スキャン（JAN または 商品コード）
 * - 強制OK / 保留
 * - QR印刷フラグ手動切替
 * - 完了（納品書№スキャン → packed + 自動印刷）
 *
 * フロー:
 *  1. mount 時に POST /api/inspect/start で session を取得
 *  2. スキャン: POST /api/inspect/scan → matched なら scannedQty++
 *  3. 完了: 全アイテム済なら 納品書№入力 → POST /api/inspect/complete
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

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

export function InspectionScreen({ order: initialOrder, employee }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState(initialOrder);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [lastResult, setLastResult] = useState<{ result: ScanResult; itemId: number | null } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [completionInfo, setCompletionInfo] = useState<{
    durationSec: number;
    qrPrintFlag: boolean;
    print: { ok: boolean; dryRun: boolean } | null;
  } | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

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
        if (j.data?.id) setSessionId(j.data.id);
        else setErrorMsg(j.message ?? 'セッション開始に失敗');
      })
      .catch((e) => setErrorMsg(String(e)));
  }, [order.pkNo, sessionId, completed]);

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
      if (!res.ok) {
        setErrorMsg(j.message ?? `エラー: HTTP ${res.status}`);
      } else {
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
    if (!reason) return;
    if (!sessionId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/inspect/force-ok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, itemId: item.id, reason }),
      });
      if (res.ok) await refreshOrder();
      else {
        const j = await res.json();
        setErrorMsg(j.message ?? '強制OK失敗');
      }
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
      if (res.ok) {
        setOrder({ ...order, qrPrintFlag: !order.qrPrintFlag });
      } else {
        const j = await res.json();
        setErrorMsg(j.message ?? 'フラグ切替失敗');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onComplete(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceNo.trim() || !sessionId) return;
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
      if (res.ok) router.push('/tablet');
      else {
        const j = await res.json();
        setErrorMsg(j.message ?? '保留失敗');
      }
    } finally {
      setBusy(false);
    }
  }

  if (completed) {
    return (
      <main className="min-h-screen bg-green-50 p-6">
        <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-md p-6 text-center">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-green-700 mb-2">梱包完了</h1>
          <p className="text-gray-600 mb-6">
            ピッキング№ <code className="font-mono">{order.pkNo}</code> を packed に更新しました
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
            onClick={() => router.push('/tablet')}
            className="w-full bg-blue-600 text-white rounded-lg py-4 text-lg font-medium hover:bg-blue-700"
          >
            次の伝票へ
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* ヘッダ */}
        <div className="bg-white rounded-xl shadow p-4">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="text-xs text-gray-500">ピッキング№</div>
              <div className="text-xl font-mono font-bold">{order.pkNo}</div>
            </div>
            <button
              onClick={() => router.push('/tablet')}
              className="text-sm text-gray-500 hover:underline"
            >
              ← 戻る
            </button>
          </div>
          <div className="text-sm text-gray-700 grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
            <div>運送会社: {order.carrier?.short ?? order.carrier?.name ?? '—'}</div>
            <div>状態: {order.status}</div>
            <div>配送先: {order.destName ?? '—'}</div>
            <div className="truncate">{order.destZip} {order.destAddr}</div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm">QR印刷フラグ:</span>
            <button
              onClick={onTogglePrintFlag}
              disabled={busy}
              className={`px-3 py-1 rounded font-medium text-sm ${
                order.qrPrintFlag
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700'
              }`}
            >
              {order.qrPrintFlag ? '🖨 ON' : '○ OFF'}
            </button>
            <span className="text-xs text-gray-500">タップで切替</span>
          </div>
        </div>

        {/* スキャン入力 */}
        <div className="bg-white rounded-xl shadow p-4">
          <form onSubmit={onScan} className="flex gap-2">
            <input
              ref={scanInputRef}
              type="text"
              autoFocus
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              className="flex-1 border-2 rounded-lg px-4 py-3 text-lg font-mono"
              placeholder="JAN または 商品コードをスキャン"
            />
            <button
              type="submit"
              disabled={busy || !scanInput.trim() || !sessionId}
              className="px-6 bg-blue-600 text-white rounded-lg font-medium disabled:bg-gray-300"
            >
              スキャン
            </button>
          </form>
          {lastResult && (
            <div
              className={`mt-3 p-2 rounded text-sm ${
                lastResult.result === 'matched'
                  ? 'bg-green-50 text-green-800'
                  : lastResult.result === 'already_done'
                    ? 'bg-gray-100 text-gray-700'
                    : 'bg-red-50 text-red-700'
              }`}
            >
              直近スキャン: <strong>{lastResult.result}</strong>
            </div>
          )}
          {errorMsg && (
            <div className="mt-3 p-2 rounded text-sm bg-red-50 text-red-700">
              {errorMsg}
            </div>
          )}
        </div>

        {/* 商品リスト */}
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold mb-2">商品 ({order.items.length} 品目)</h2>
          <ul className="space-y-2">
            {order.items.map((it) => {
              const done = it.forceOk || it.scannedQty >= it.qty;
              return (
                <li
                  key={it.id}
                  className={`border rounded-lg p-3 flex items-center gap-3 ${
                    done ? 'bg-green-50 border-green-200' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {it.productName}
                      {it.productFrozen && (
                        <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1 rounded">
                          冷凍
                        </span>
                      )}
                      {it.forceOk && (
                        <span className="ml-1 text-xs bg-yellow-100 text-yellow-800 px-1 rounded">
                          強制OK
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 font-mono">
                      {it.productCode} / JAN: {it.productJan ?? '—'}
                    </div>
                    {it.forceOk && it.forceReason && (
                      <div className="text-xs text-yellow-700 mt-1">理由: {it.forceReason}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-lg font-bold ${done ? 'text-green-700' : 'text-gray-700'}`}
                    >
                      {it.scannedQty} / {it.qty}
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

        {/* 完了 */}
        <div className="bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold mb-2">納品書№ をスキャンして完了</h2>
          <form onSubmit={onComplete} className="flex gap-2 mb-2">
            <input
              type="text"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              className="flex-1 border-2 rounded-lg px-4 py-3 text-lg font-mono"
              placeholder="00059546010001"
              disabled={!allInspected || busy}
            />
            <button
              type="submit"
              disabled={!allInspected || busy || !invoiceNo.trim()}
              className="px-6 bg-green-600 text-white rounded-lg font-medium disabled:bg-gray-300"
            >
              梱包完了
            </button>
          </form>
          {!allInspected && (
            <p className="text-xs text-gray-500">
              すべての商品をスキャン or 強制OK にすると押せます
            </p>
          )}
          <div className="mt-3 text-right">
            <button onClick={onHold} disabled={busy} className="text-sm text-orange-600 hover:underline">
              一時保留
            </button>
          </div>
        </div>

        <div className="text-center text-xs text-gray-400">
          作業者: {employee?.name}（{employee?.empCode}） / 端末: {employee?.deviceCode}
        </div>
      </div>
    </main>
  );
}
