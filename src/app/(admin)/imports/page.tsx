'use client';

/**
 * 管理PC: Thomas CSV 取込画面（Phase 7-5 ダーク化）
 */

import { useEffect, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { FileInput } from '@/components/ui/form-controls';
import { StatCard } from '@/components/ui/stat-card';
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';

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
    <main className="p-4 max-w-6xl mx-auto space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-ink-strong">📥 Thomas CSV 取込</h1>
        <p className="text-2xs text-ink-subtle">
          Thomas（基幹）出力の商品マスタCSV / 出荷指示CSVをアップロード（種別自動判定）
        </p>
      </header>

      {/* 取込フォーム */}
      <Panel>
        <PanelBody>
          <form onSubmit={handleSubmit} className="flex items-center gap-3">
            <FileInput
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="flex-1"
            />
            <Button type="submit" disabled={!file || busy}>
              {busy ? '取込中…' : '取込実行'}
            </Button>
          </form>
        </PanelBody>
      </Panel>

      {errorMsg && (
        <div className="bg-status-error-bg border border-status-error/40 text-status-error rounded-lg p-3 text-sm">
          <strong>取込失敗:</strong> {errorMsg}
        </div>
      )}

      {/* 取込結果 */}
      {result && (
        <Panel>
          <PanelHeader
            title={`取込結果（${result.fileType}）`}
            meta={result.filename}
          />
          <PanelBody className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <StatCard label="総行数" value={result.totalRows} />
              <StatCard label="成功" value={result.successCount} tone="ok" />
              <StatCard label="エラー" value={result.errorCount} tone="error" />
              <StatCard label="JAN 不備" value={result.janErrorCount} tone="warn" />
              <StatCard label="PkNo 重複" value={result.duplicatePkNoCount} tone="warn" />
              <StatCard label="未マップ" value={result.unmapCount} tone="amber" />
            </div>

            {result.unmappedCodes.length > 0 && (
              <div className="text-xs">
                <strong className="text-ink-subtle">未マップ商品コード:</strong>{' '}
                <code className="text-accent-amber font-mono">
                  {result.unmappedCodes.join(', ')}
                </code>
              </div>
            )}

            {result.errors.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs font-bold text-status-error">
                  エラー詳細 ({result.errors.length} 件)
                </summary>
                <ul className="mt-2 space-y-1 text-3xs max-h-64 overflow-auto bg-surface-base rounded p-2 border border-surface-border">
                  {result.errors.map((err, i) => (
                    <li key={i} className="border-l-2 border-status-error pl-2 py-0.5">
                      <span className="text-ink-muted">行 {err.rowIndex}</span>{' '}
                      <Badge variant="error">{err.reason}</Badge>{' '}
                      {err.pkNo && <span className="font-mono">PkNo={err.pkNo} </span>}
                      {err.productCode && <span className="font-mono">商品={err.productCode} </span>}
                      <span className="text-ink-subtle">— {err.message}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </PanelBody>
        </Panel>
      )}

      {/* 取込履歴 */}
      <Panel>
        <PanelHeader title="取込履歴" meta={`${history.length} 件`} />
        <Table>
          <THead>
            <TH>ID</TH>
            <TH>取込日時</TH>
            <TH>種別</TH>
            <TH>ファイル名</TH>
            <TH align="right">総行数</TH>
            <TH align="right">成功</TH>
            <TH align="right">エラー</TH>
            <TH align="right">JAN不備</TH>
            <TH align="right">未マップ</TH>
          </THead>
          <TBody>
            {history.length === 0 && <EmptyRow colSpan={9} message="取込履歴はまだありません" />}
            {history.map((h) => (
              <TR key={h.id}>
                <TD mono>{h.id}</TD>
                <TD className="text-2xs">{new Date(h.importedAt).toLocaleString('ja-JP')}</TD>
                <TD>
                  <Badge variant={h.fileType === 'orders' ? 'info' : 'neutral'}>
                    {h.fileType}
                  </Badge>
                </TD>
                <TD className="text-3xs truncate max-w-xs font-mono">{h.filename}</TD>
                <TD align="right" mono>
                  {h.totalRows}
                </TD>
                <TD align="right" mono className="text-status-ok">
                  {h.successCount}
                </TD>
                <TD align="right" mono className={h.errorCount > 0 ? 'text-status-error' : 'text-ink-muted'}>
                  {h.errorCount}
                </TD>
                <TD align="right" mono className={h.janErrorCount > 0 ? 'text-status-warn' : 'text-ink-muted'}>
                  {h.janErrorCount}
                </TD>
                <TD align="right" mono className={h.unmapCount > 0 ? 'text-accent-amber' : 'text-ink-muted'}>
                  {h.unmapCount}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>
    </main>
  );
}
