'use client';

/**
 * 📜 受信ログ サブタブ（A-11）
 *
 * モック準拠（管理用PCモック_v0.22.html L3106-3220）。
 * GET /api/link/imports をフィルタ付き表示。
 */

import { useCallback, useEffect, useState } from 'react';

interface ImportRow {
  id: number;
  filename: string;
  fileType: string;
  importedAt: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  janErrorCount: number;
  unmapCount: number;
  importedBy: string | null;
  note: string | null;
  result: 'ok' | 'warn' | 'error';
}

export function LogPane() {
  const [items, setItems] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [fileType, setFileType] = useState('');
  const [result, setResult] = useState('');
  const [date, setDate] = useState('');
  const [q, setQ] = useState('');

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (fileType) params.set('fileType', fileType);
      if (result) params.set('result', result);
      if (date) params.set('date', date);
      if (q) params.set('q', q);
      const r = await fetch(`/api/link/imports?${params.toString()}`);
      const j = await r.json();
      setItems(j.data?.items ?? []);
    } finally {
      setBusy(false);
    }
  }, [fileType, result, date, q]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap gap-1.5 mb-2">
        <select
          value={fileType}
          onChange={(e) => setFileType(e.target.value)}
          className="bg-surface-base border border-surface-border rounded px-1.5 py-1 text-2xs text-ink"
        >
          <option value="">すべての種別</option>
          <option value="products">商品マスタ</option>
          <option value="orders">出荷指示</option>
          <option value="sort">仕分け作業指示</option>
        </select>
        <select
          value={result}
          onChange={(e) => setResult(e.target.value)}
          className="bg-surface-base border border-surface-border rounded px-1.5 py-1 text-2xs text-ink"
        >
          <option value="">すべての結果</option>
          <option value="ok">成功</option>
          <option value="warn">警告</option>
          <option value="error">失敗</option>
        </select>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-surface-base border border-surface-border rounded px-1.5 py-1 text-2xs text-ink"
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 ファイル名・備考"
          className="flex-1 min-w-[140px] bg-surface-base border border-surface-border rounded px-1.5 py-1 text-2xs text-ink"
        />
      </div>

      <div className="flex-1 overflow-auto border border-surface-border rounded">
        <table className="w-full text-2xs">
          <thead className="bg-surface-base sticky top-0 border-b border-surface-border">
            <tr>
              <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">取込日時</th>
              <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">種別</th>
              <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">ファイル名</th>
              <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">行数</th>
              <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">成功</th>
              <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">エラー</th>
              <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">未マップ</th>
              <th className="px-1.5 py-1 text-center text-3xs uppercase text-ink-subtle">結果</th>
              <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">備考</th>
              <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">操作者</th>
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={10} className="text-center py-4 text-2xs text-ink-muted">
                  読み込み中…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-6 text-2xs text-ink-muted">
                  取込履歴がありません
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className="border-t border-surface-border">
                  <td className="px-1.5 py-1 font-mono">{formatDateTime(row.importedAt)}</td>
                  <td className="px-1.5 py-1">{translateFileType(row.fileType)}</td>
                  <td className="px-1.5 py-1 font-mono text-ink-subtle truncate max-w-[260px]">
                    {row.filename}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{row.totalRows.toLocaleString()}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-status-ok">{row.successCount.toLocaleString()}</td>
                  <td
                    className={`px-1.5 py-1 text-right tabular-nums ${row.errorCount > 0 ? 'text-status-error' : 'text-ink-muted'}`}
                  >
                    {row.errorCount}
                  </td>
                  <td
                    className={`px-1.5 py-1 text-right tabular-nums ${row.unmapCount > 0 ? 'text-status-warn' : 'text-ink-muted'}`}
                  >
                    {row.unmapCount}
                  </td>
                  <td className="px-1.5 py-1 text-center">
                    <ResultPill result={row.result} />
                  </td>
                  <td className="px-1.5 py-1 truncate max-w-[180px] text-ink-subtle">{row.note ?? '—'}</td>
                  <td className="px-1.5 py-1 text-ink-subtle truncate max-w-[100px]">
                    {row.importedBy ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="text-3xs text-ink-muted mt-2 text-right">
        {items.length} 件 ／ 200 件まで表示
      </div>
    </div>
  );
}

function ResultPill({ result }: { result: 'ok' | 'warn' | 'error' }) {
  switch (result) {
    case 'ok':
      return <span className="px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-100 text-[9px] font-bold">成功</span>;
    case 'warn':
      return <span className="px-1.5 py-0.5 rounded bg-amber-900 text-amber-100 text-[9px] font-bold">警告</span>;
    case 'error':
      return <span className="px-1.5 py-0.5 rounded bg-red-900 text-red-100 text-[9px] font-bold">失敗</span>;
  }
}

function translateFileType(t: string): string {
  switch (t) {
    case 'orders':
      return '出荷指示';
    case 'products':
      return '商品マスタ';
    case 'sort':
      return '仕分け指示';
    default:
      return t;
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
