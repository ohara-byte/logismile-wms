'use client';

/**
 * 管理PC: Thomas CSV 取込画面（Phase 7-5 ダーク化 / Sprint K-1, K-2 改修）
 *
 * 機能:
 *  - ドラッグ＆ドロップで複数 CSV を投入できる（既存ボタン経由でも可）
 *  - キュー内は ファイル名（+サイズ） で重複排除
 *  - 実行押下で 1 ファイルずつ /api/orders/import に送信
 *  - 成否は各ファイル横にバッジ表示。エラー時はメッセージ展開
 *  - モック準拠（管理用PCモック_v0.22.html L1975-2054 csvi-modal）
 */

import { useEffect, useRef, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { MasterImportPanel } from './_components/master-import-panel';

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
    invoiceNo?: string;
    productCode?: string;
    reason: string;
    message: string;
  }>;
}

type QueueStatus = 'pending' | 'running' | 'done' | 'error';

interface QueueItem {
  /** 一意キー（filename + size + lastModified） */
  key: string;
  file: File;
  status: QueueStatus;
  result?: ImportResultPayload;
  errorMsg?: string;
}

function makeQueueKey(f: File): string {
  return `${f.name}::${f.size}::${f.lastModified}`;
}

/**
 * 取込の処理順ランク（小さいほど先に処理）。
 *   0 = 商品マスタ（①/商品マスタ/master）／2 = 出荷指示（②/出荷指示/order）／1 = 不明。
 * 順序保証：新商品を含む出荷指示が、その商品を定義する商品マスタより先に取り込まれて
 *   伝票が丸ごと落ちる事故（2026-07-07）を防ぐため、商品マスタを必ず先に処理する。
 */
function fileTypeRank(name: string): number {
  const n = name.toLowerCase();
  if (name.includes('①') || name.includes('商品マスタ') || n.includes('master') || n.includes('product')) {
    return 0;
  }
  if (name.includes('②') || name.includes('出荷指示') || n.includes('order') || n.includes('shipping')) {
    return 2;
  }
  return 1;
}

export default function ImportsPage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function reloadHistory() {
    const res = await fetch('/api/imports');
    if (!res.ok) return;
    const json = await res.json();
    setHistory(json.data?.items ?? []);
  }

  useEffect(() => {
    reloadHistory();
  }, []);

  /** キューへのファイル追加（重複排除） */
  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.csv'));
    if (arr.length === 0) return;
    setQueue((prev) => {
      const seen = new Set(prev.map((q) => q.key));
      const next = [...prev];
      let dup = 0;
      for (const f of arr) {
        const key = makeQueueKey(f);
        if (seen.has(key)) {
          dup++;
          continue;
        }
        seen.add(key);
        next.push({ key, file: f, status: 'pending' });
      }
      if (dup > 0) {
        // 重複は静かにスキップ（UI 上もキュー件数で確認できる）
        console.info(`[imports] 重複ファイル ${dup} 件をスキップ`);
      }
      return next;
    });
  }

  function removeFromQueue(key: string) {
    setQueue((prev) => prev.filter((q) => q.key !== key));
  }

  function clearCompleted() {
    setQueue((prev) => prev.filter((q) => q.status === 'pending' || q.status === 'running'));
  }

  function clearAll() {
    setQueue([]);
  }

  /** D&D ハンドラ */
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  /** 1 件ずつ順番に取込実行 */
  async function runAll() {
    setBusy(true);
    try {
      // pending を頭から処理
      let cursor = 0;
      while (true) {
        const next = (await new Promise<QueueItem | null>((resolve) => {
          setQueue((prev) => {
            // 順序保証：pending のうち処理ランクが最小（＝商品マスタ優先）のものを選ぶ。
            //   同ランクは元の並び順（先に積んだ順）を維持。
            let idx = -1;
            let bestRank = Number.POSITIVE_INFINITY;
            for (let k = 0; k < prev.length; k++) {
              if (prev[k].status !== 'pending') continue;
              const r = fileTypeRank(prev[k].file.name);
              if (r < bestRank) {
                bestRank = r;
                idx = k;
              }
            }
            if (idx < 0) {
              resolve(null);
              return prev;
            }
            const updated = [...prev];
            updated[idx] = { ...updated[idx], status: 'running' };
            resolve(updated[idx]);
            return updated;
          });
        })) as QueueItem | null;
        if (!next) break;
        cursor++;
        try {
          const fd = new FormData();
          fd.append('file', next.file);
          const res = await fetch('/api/orders/import', { method: 'POST', body: fd });
          const json = await res.json();
          if (!res.ok) {
            setQueue((prev) =>
              prev.map((q) =>
                q.key === next.key
                  ? { ...q, status: 'error', errorMsg: json.message ?? `HTTP ${res.status}` }
                  : q,
              ),
            );
          } else {
            setQueue((prev) =>
              prev.map((q) =>
                q.key === next.key ? { ...q, status: 'done', result: json.data } : q,
              ),
            );
          }
        } catch (e) {
          setQueue((prev) =>
            prev.map((q) =>
              q.key === next.key
                ? { ...q, status: 'error', errorMsg: (e as Error).message }
                : q,
            ),
          );
        }
        // 安全装置（万一無限ループになっても 100 件で止める）
        if (cursor > 100) break;
      }
      await reloadHistory();
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = queue.filter((q) => q.status === 'pending').length;
  const doneCount = queue.filter((q) => q.status === 'done').length;
  const errorCount = queue.filter((q) => q.status === 'error').length;

  return (
    <main className="p-4 max-w-6xl mx-auto space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-ink-strong">📥 Thomas CSV 取込</h1>
        <p className="text-2xs text-ink-subtle">
          Thomas（基幹）出力 商品マスタCSV / 出荷指示CSV をアップロード（種別自動判定）
        </p>
      </header>

      {/* 基幹マスタ取込（箱・構成・標準時間・のし/エアパック設定の素地）— 2026-06-22 */}
      <MasterImportPanel />

      {/* K-2: ドラッグ＆ドロップ ゾーン */}
      <Panel>
        <PanelBody>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-accent-amber bg-amber-950/20 text-accent-amber'
                : 'border-surface-border-strong bg-surface-base text-ink-subtle hover:border-accent-amber/60 hover:text-accent-amber'
            }`}
          >
            <div className="text-4xl mb-2">📂</div>
            <div className="text-sm font-bold">
              ここに CSV ファイルをドロップ（複数可）／ クリックで選択
            </div>
            <div className="text-3xs text-ink-muted mt-1">
              対応: 商品マスタ CSV / 出荷指示 CSV（重複ファイルはスキップ）
            </div>
            <div className="text-3xs text-accent-amber/80 mt-0.5">
              ※ まとめて投入しても、取込は「商品マスタ①→出荷指示②」の順で自動実行します（新商品の伝票落ち防止）
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.currentTarget.value = '';
              }}
            />
          </div>
        </PanelBody>
      </Panel>

      {/* キュー一覧 */}
      {queue.length > 0 && (
        <Panel>
          <PanelHeader
            title={`取込キュー（${queue.length} 件）`}
            meta={`待機 ${pendingCount} ／ 完了 ${doneCount} ／ エラー ${errorCount}`}
            action={
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="success"
                  onClick={runAll}
                  disabled={busy || pendingCount === 0}
                >
                  {busy ? '取込中…' : `▶ 取込実行（${pendingCount}）`}
                </Button>
                <Button size="sm" onClick={clearCompleted} disabled={busy}>
                  完了をクリア
                </Button>
                <Button size="sm" onClick={clearAll} disabled={busy}>
                  全消去
                </Button>
              </div>
            }
          />
          <PanelBody>
            <div className="border border-surface-border rounded overflow-hidden">
              <table className="w-full text-2xs">
                <thead className="bg-surface-base border-b border-surface-border">
                  <tr>
                    <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">状態</th>
                    <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">ファイル名</th>
                    <th className="px-2 py-1 text-right text-3xs uppercase text-ink-subtle">サイズ</th>
                    <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">結果</th>
                    <th className="px-2 py-1 text-right text-3xs uppercase text-ink-subtle">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((q) => (
                    <tr key={q.key} className="border-t border-surface-border">
                      <td className="px-2 py-1">
                        <StatusBadge status={q.status} />
                      </td>
                      <td className="px-2 py-1 font-mono text-3xs truncate max-w-[260px]">
                        {q.file.name}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink-subtle">
                        {Math.round(q.file.size / 1024).toLocaleString()} KB
                      </td>
                      <td className="px-2 py-1 text-3xs">
                        {q.status === 'done' && q.result && (
                          <span>
                            <Badge variant={q.result.fileType === 'orders' ? 'info' : 'neutral'}>
                              {q.result.fileType}
                            </Badge>
                            <span className="ml-1 text-status-ok">
                              成功 {q.result.successCount}
                            </span>
                            {q.result.errorCount > 0 && (
                              <span className="ml-1 text-status-error">
                                エラー {q.result.errorCount}
                              </span>
                            )}
                            {q.result.unmapCount > 0 && (
                              <span className="ml-1 text-accent-amber">
                                未マップ {q.result.unmapCount}
                              </span>
                            )}
                          </span>
                        )}
                        {q.status === 'error' && (
                          <span className="text-status-error">⚠ {q.errorMsg}</span>
                        )}
                        {q.status === 'pending' && <span className="text-ink-muted">未実行</span>}
                        {q.status === 'running' && (
                          <span className="text-status-info">取込中…</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {q.status !== 'running' && (
                          <button
                            onClick={() => removeFromQueue(q.key)}
                            className="text-ink-subtle hover:text-status-error text-sm"
                            disabled={busy && q.status === 'pending'}
                            title="キューから削除"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* 直近結果のサマリ（完了 1 件以上の場合） */}
      {queue.some((q) => q.status === 'done' && q.result) && (
        <Panel>
          <PanelHeader title="📋 直近の取込結果サマリ" />
          <PanelBody className="space-y-3">
            {queue
              .filter((q) => q.status === 'done' && q.result)
              .map((q) => {
                const r = q.result!;
                return (
                  <div key={q.key} className="border border-surface-border rounded p-2 bg-surface-base">
                    <div className="text-xs font-bold text-ink-strong mb-1">
                      {q.file.name}{' '}
                      <Badge variant={r.fileType === 'orders' ? 'info' : 'neutral'}>
                        {r.fileType}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                      <StatCard label="総行数" value={r.totalRows} />
                      <StatCard label="成功" value={r.successCount} tone="ok" />
                      <StatCard label="エラー" value={r.errorCount} tone="error" />
                      <StatCard label="JAN 不備" value={r.janErrorCount} tone="warn" />
                      <StatCard label="PkNo 重複" value={r.duplicatePkNoCount} tone="warn" />
                      <StatCard label="未マップ" value={r.unmapCount} tone="amber" />
                    </div>
                    {r.unmappedCodes.length > 0 && (
                      <div className="text-3xs mt-2">
                        <strong className="text-ink-subtle">未マップ商品コード:</strong>{' '}
                        <code className="text-accent-amber font-mono">
                          {r.unmappedCodes.join(', ')}
                        </code>
                      </div>
                    )}
                    {r.errors.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-3xs font-bold text-status-error">
                          エラー詳細 ({r.errors.length} 件)
                        </summary>
                        <ul className="mt-1 space-y-0.5 text-3xs max-h-48 overflow-auto bg-surface-panel rounded p-2 border border-surface-border">
                          {r.errors.map((err, i) => (
                            <li key={i} className="border-l-2 border-status-error pl-2 py-0.5">
                              <span className="text-ink-muted">行 {err.rowIndex}</span>{' '}
                              <Badge variant="error">{err.reason}</Badge>{' '}
                              {err.invoiceNo && (
                                <span className="font-mono">納品書={err.invoiceNo} </span>
                              )}
                              {err.pkNo && <span className="font-mono">PkNo={err.pkNo} </span>}
                              {err.productCode && (
                                <span className="font-mono">商品={err.productCode} </span>
                              )}
                              <span className="text-ink-subtle">— {err.message}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
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
                <TD
                  align="right"
                  mono
                  className={h.errorCount > 0 ? 'text-status-error' : 'text-ink-muted'}
                >
                  {h.errorCount}
                </TD>
                <TD
                  align="right"
                  mono
                  className={h.janErrorCount > 0 ? 'text-status-warn' : 'text-ink-muted'}
                >
                  {h.janErrorCount}
                </TD>
                <TD
                  align="right"
                  mono
                  className={h.unmapCount > 0 ? 'text-accent-amber' : 'text-ink-muted'}
                >
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

function StatusBadge({ status }: { status: QueueStatus }) {
  const map: Record<QueueStatus, { label: string; cls: string }> = {
    pending: { label: '待機', cls: 'bg-surface-raised text-ink-subtle' },
    running: { label: '取込中', cls: 'bg-blue-900/60 text-blue-100 animate-pulse' },
    done: { label: '✓ 完了', cls: 'bg-emerald-900/60 text-emerald-100' },
    error: { label: '⚠ エラー', cls: 'bg-red-900/60 text-red-100' },
  };
  const m = map[status];
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${m.cls}`}>
      {m.label}
    </span>
  );
}
