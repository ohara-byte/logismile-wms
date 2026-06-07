'use client';

/**
 * プリンタ試刷クライアント。
 *
 * - GET  /api/master/printers       で一覧取得（admin/manager 権限）
 * - POST /api/print/qr/test         で試刷
 * - GET  /api/print/logs?limit=10   で直近ログ表示（test=true でフィルタ可能）
 */

import { useCallback, useEffect, useState } from 'react';

interface Printer {
  code: string;
  name: string;
  ipAddress: string;
  port: number;
  model: string;
  location: string | null;
  labelSize: string;
  active: boolean;
}

interface TestResult {
  ok: boolean;
  dryRun: boolean;
  bytesSent: number;
  elapsedMs: number;
  printer: { code: string; name: string; ipAddress: string; port: number; labelSize: string };
  payload: { invoiceNo: string; pkNo: string };
}

interface PrintLog {
  id: number;
  pkNo: string;
  invoiceNo: string | null;
  printerCode: string;
  status: string;
  errorMsg: string | null;
  createdAt: string;
}

const DEFAULT_INVOICE = 'TEST-00000-001';
const DEFAULT_PKNO = 'SX99999999999';

export function PrinterTestClient() {
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [invoiceNo, setInvoiceNo] = useState(DEFAULT_INVOICE);
  const [pkNo, setPkNo] = useState(DEFAULT_PKNO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [logs, setLogs] = useState<PrintLog[]>([]);

  const loadPrinters = useCallback(async () => {
    try {
      const r = await fetch('/api/master/printers');
      if (!r.ok) throw new Error(`プリンタ一覧の取得に失敗 (HTTP ${r.status})`);
      const j = await r.json();
      const items: Printer[] = j.data?.items ?? [];
      setPrinters(items);
      // 既定: active な最初の 1 台
      const def = items.find((p) => p.active) ?? items[0];
      if (def) setSelected(def.code);
    } catch (e) {
      setError(String(e));
      setPrinters([]);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const r = await fetch('/api/print/logs?limit=10');
      if (!r.ok) return;
      const j = await r.json();
      setLogs(j.data?.items ?? []);
    } catch {
      // ログ取得失敗は試刷自体には影響させない
    }
  }, []);

  useEffect(() => {
    loadPrinters();
    loadLogs();
  }, [loadPrinters, loadLogs]);

  async function onSubmit() {
    if (!selected) {
      setError('プリンタを選択してください');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/print/qr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printerCode: selected,
          invoiceNo: invoiceNo || undefined,
          pkNo: pkNo || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.message ?? `HTTP ${r.status}`);
        return;
      }
      setResult(j.data as TestResult);
      void loadLogs();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (printers === null) {
    return (
      <div className="text-sm text-ink-muted flex items-center gap-2">
        <span className="w-2 h-2 bg-accent-amber rounded-full animate-pulse" />
        プリンタ一覧を読み込み中…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* プリンタ選択フォーム */}
      <div className="bg-surface-panel border border-surface-border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-bold text-accent-amber uppercase tracking-wider">
          試刷設定
        </h2>

        {printers.length === 0 ? (
          <p className="text-xs text-status-error">
            プリンタマスタにレコードがありません。先に「マスタ」タブからプリンタを登録してください。
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="block text-xs text-ink-subtle mb-1">プリンタ</span>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full bg-surface-base border border-surface-border rounded px-3 py-2 text-sm text-ink"
              >
                {printers.map((p) => (
                  <option key={p.code} value={p.code} disabled={!p.active}>
                    {p.name}（{p.code}） — {p.ipAddress}:{p.port}
                    {!p.active && '（無効）'}
                    {p.location ? ` ／ ${p.location}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-ink-subtle mb-1">
                  試刷 納品書№
                </span>
                <input
                  type="text"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder={DEFAULT_INVOICE}
                  className="w-full bg-surface-base border border-surface-border rounded px-3 py-2 text-sm font-mono text-ink"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-ink-subtle mb-1">
                  試刷 ピッキング№
                </span>
                <input
                  type="text"
                  value={pkNo}
                  onChange={(e) => setPkNo(e.target.value)}
                  placeholder={DEFAULT_PKNO}
                  className="w-full bg-surface-base border border-surface-border rounded px-3 py-2 text-sm font-mono text-ink"
                />
              </label>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={onSubmit}
                disabled={busy || !selected}
                className="px-5 py-2 rounded bg-pink-700 text-white font-bold text-sm border border-pink-500 hover:bg-pink-600 disabled:opacity-50"
              >
                {busy ? '送信中…' : '🖨 試刷を実行'}
              </button>
              <span className="text-3xs text-ink-muted">
                ※ 30×40mm の QR ラベル × 1 枚
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="p-2.5 text-xs bg-status-error-bg text-status-error border border-status-error rounded">
            ⚠ {error}
          </div>
        )}

        {result && (
          <div
            className={`p-3 rounded text-sm ${
              result.ok
                ? 'bg-emerald-950/40 border border-status-ok text-emerald-100'
                : 'bg-red-950/40 border border-status-error text-red-100'
            }`}
          >
            <div className="font-bold mb-1">
              {result.ok ? '✓ 送信成功' : '✗ 送信失敗'}
              {result.dryRun && (
                <span className="ml-2 px-2 py-0.5 rounded bg-amber-700 text-amber-50 text-3xs">
                  DRY-RUN
                </span>
              )}
            </div>
            <div className="text-xs opacity-90 leading-relaxed">
              プリンタ: <b>{result.printer.name}</b>（{result.printer.code} / {result.printer.ipAddress}:{result.printer.port}）<br />
              ペイロード: <b>{result.bytesSent}</b> bytes / 所要 <b>{result.elapsedMs}</b> ms<br />
              印字内容: 納品書№ <span className="font-mono">{result.payload.invoiceNo}</span>{' '}
              ／ ピッキング№ <span className="font-mono">{result.payload.pkNo}</span>
            </div>
          </div>
        )}
      </div>

      {/* 直近の印刷ログ */}
      <div className="bg-surface-panel border border-surface-border rounded-lg p-4">
        <h2 className="text-sm font-bold text-accent-amber uppercase tracking-wider mb-2">
          直近の印刷ログ（最新 10 件）
        </h2>
        {logs.length === 0 ? (
          <p className="text-xs text-ink-muted">履歴がありません</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-2xs text-ink-subtle border-b border-surface-border">
              <tr>
                <th className="text-left py-1">時刻</th>
                <th className="text-left py-1">プリンタ</th>
                <th className="text-left py-1">納品書№</th>
                <th className="text-left py-1">PkNo</th>
                <th className="text-left py-1">結果</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-surface-border/50 hover:bg-surface-base"
                >
                  <td className="py-1.5 font-mono text-ink-muted">
                    {formatTs(l.createdAt)}
                  </td>
                  <td className="py-1.5 font-mono">{l.printerCode}</td>
                  <td className="py-1.5 font-mono text-ink-subtle">
                    {l.invoiceNo ?? '—'}
                  </td>
                  <td className="py-1.5 font-mono text-ink-subtle">{l.pkNo}</td>
                  <td className="py-1.5">
                    <StatusBadge status={l.status} note={l.errorMsg} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, note }: { status: string; note: string | null }) {
  const isDryRun = note === 'DRY-RUN';
  if (isDryRun) {
    return (
      <span className="px-1.5 py-0.5 rounded bg-amber-700 text-amber-50 text-3xs font-bold">
        DRY-RUN
      </span>
    );
  }
  if (status === 'success') {
    return (
      <span className="px-1.5 py-0.5 rounded bg-emerald-700 text-emerald-50 text-3xs font-bold">
        SUCCESS
      </span>
    );
  }
  return (
    <span
      title={note ?? ''}
      className="px-1.5 py-0.5 rounded bg-red-700 text-red-50 text-3xs font-bold"
    >
      FAILED
    </span>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
