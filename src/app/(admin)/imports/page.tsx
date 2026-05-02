/**
 * 管理PC: Thomas CSV 取込画面（簡易版）
 *
 * - CSV をアップロードして取込実行
 * - 取込結果（成功/エラー/未マップ等）を表示
 * - 取込履歴一覧を表示
 *
 * Phase 1-7（管理PC認証）完成後に admin/manager のみアクセス可能にする。
 */

'use client';

import { useEffect, useState } from 'react';

interface ImportRecord {
  id: number;
  filename: string;
  fileType: string;
  importedAt: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  janErrorCount: number;
  unmapCount: number;
}

interface ImportResultPayload {
  importId: number;
  fileType: string;
  filename: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  janErrorCount: number;
  duplicatePkNoCount: number;
  unmapCount: number;
  unmappedCodes: string[];
  errors: Array<{
    rowIndex: number;
    pkNo?: string;
    productCode?: string;
    reason: string;
    message: string;
  }>;
}

export default function ImportsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResultPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<ImportRecord[]>([]);

  async function reloadHistory() {
    const res = await fetch('/api/imports');
    if (!res.ok) return;
    const json = await res.json();
    setHistory(json.data?.items ?? []);
  }

  useEffect(() => {
    reloadHistory();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setResult(null);
    setErrorMsg(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/orders/import', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.message ?? `エラー: HTTP ${res.status}`);
      } else {
        setResult(json.data);
        await reloadHistory();
      }
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Thomas CSV 取込</h1>
      <p className="text-sm text-gray-600 mb-6">
        Thomas（基幹）から出力された商品マスタCSV / 出荷指示CSVをアップロードして取り込みます。
        ファイル種別はヘッダから自動判定されます。
      </p>

      <form onSubmit={handleSubmit} className="border rounded-lg p-4 bg-white shadow-sm mb-6 flex items-center gap-4">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="flex-1"
        />
        <button
          type="submit"
          disabled={!file || busy}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300"
        >
          {busy ? '取込中…' : '取込実行'}
        </button>
      </form>

      {errorMsg && (
        <div className="border border-red-300 bg-red-50 text-red-800 rounded-lg p-4 mb-6">
          <strong>取込失敗:</strong> {errorMsg}
        </div>
      )}

      {result && (
        <div className="border rounded-lg p-4 bg-white shadow-sm mb-6">
          <h2 className="text-lg font-semibold mb-3">
            取込結果 ({result.fileType} / {result.filename})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
            <Stat label="総行数" value={result.totalRows} />
            <Stat label="成功" value={result.successCount} color="green" />
            <Stat label="エラー" value={result.errorCount} color="red" />
            <Stat label="JAN不備" value={result.janErrorCount} color="yellow" />
            <Stat label="PkNo重複" value={result.duplicatePkNoCount} color="orange" />
            <Stat label="未マップ" value={result.unmapCount} color="purple" />
          </div>
          {result.unmappedCodes.length > 0 && (
            <div className="mt-3 text-sm">
              <strong>未マップ商品コード:</strong>{' '}
              <code className="text-purple-700">{result.unmappedCodes.join(', ')}</code>
            </div>
          )}
          {result.errors.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">
                エラー詳細 ({result.errors.length} 件)
              </summary>
              <ul className="mt-2 space-y-1 text-xs max-h-64 overflow-auto">
                {result.errors.map((err, i) => (
                  <li key={i} className="border-l-2 border-red-300 pl-2">
                    行 {err.rowIndex} [{err.reason}] {err.pkNo ? `PkNo=${err.pkNo} ` : ''}
                    {err.productCode ? `商品=${err.productCode} ` : ''}
                    — {err.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <h2 className="text-lg font-semibold mb-3">取込履歴</h2>
      <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">取込日時</th>
              <th className="px-3 py-2 text-left">種別</th>
              <th className="px-3 py-2 text-left">ファイル名</th>
              <th className="px-3 py-2 text-right">総行数</th>
              <th className="px-3 py-2 text-right">成功</th>
              <th className="px-3 py-2 text-right">エラー</th>
              <th className="px-3 py-2 text-right">JAN不備</th>
              <th className="px-3 py-2 text-right">未マップ</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-gray-400">
                  取込履歴はまだありません
                </td>
              </tr>
            )}
            {history.map((h) => (
              <tr key={h.id} className="border-t">
                <td className="px-3 py-2">{h.id}</td>
                <td className="px-3 py-2">{new Date(h.importedAt).toLocaleString('ja-JP')}</td>
                <td className="px-3 py-2">{h.fileType}</td>
                <td className="px-3 py-2 truncate max-w-xs">{h.filename}</td>
                <td className="px-3 py-2 text-right">{h.totalRows}</td>
                <td className="px-3 py-2 text-right text-green-700">{h.successCount}</td>
                <td className="px-3 py-2 text-right text-red-700">{h.errorCount}</td>
                <td className="px-3 py-2 text-right text-yellow-700">{h.janErrorCount}</td>
                <td className="px-3 py-2 text-right text-purple-700">{h.unmapCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  color = 'gray',
}: {
  label: string;
  value: number;
  color?: 'gray' | 'green' | 'red' | 'yellow' | 'orange' | 'purple';
}) {
  const colorMap: Record<string, string> = {
    gray: 'text-gray-700',
    green: 'text-green-700',
    red: 'text-red-700',
    yellow: 'text-yellow-700',
    orange: 'text-orange-700',
    purple: 'text-purple-700',
  };
  return (
    <div className="border rounded p-2 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${colorMap[color]}`}>{value}</div>
    </div>
  );
}
