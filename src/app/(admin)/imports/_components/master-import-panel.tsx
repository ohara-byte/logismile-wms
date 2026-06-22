'use client';

/**
 * 基幹(Thomas)マスタ取込パネル（2026-06-22）。
 * 5種のマスタファイルをアップロードして取り込み、突合レポートを表示・CSVでダウンロードする。
 * 推奨順：①箱マスタ → ②JAN軸 → ③構成品サイズ → ④BOM → ⑤セット標準時間
 * 構成品サイズの未結合は、未結合CSVをDL→「WMS商品コード」を記入→同じ枠に再アップロードで割当て。
 */

import { useRef, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/ui/panel';

interface ImportResult {
  type: string;
  filename: string;
  totalRows: number;
  imported: number;
  skipped: number;
  unmatched: number;
  warnings: string[];
  unmatchedSample: Record<string, string>[];
  unmatchedCsv: string;
}

interface Kind {
  type: string;
  label: string;
  accept: string;
  hint: string;
}

const KINDS: Kind[] = [
  { type: 'box_master', label: '① 箱マスタ', accept: '.xlsx', hint: '箱マスタ.xlsx（WMS箱コード・寸法・田舎主義コード）' },
  { type: 'jan_bridge', label: '② JAN軸 統合', accept: '.csv', hint: '…構成商品JAN軸.csv（商品番号・JANを補完）' },
  { type: 'comp_size', label: '③ 構成品サイズ', accept: '.xlsx,.csv', hint: 'サイズ一覧.xlsx／未結合を埋めた割当てCSVの再UL' },
  { type: 'bom', label: '④ BOM（構成）', accept: '.csv', hint: '構成商品.csv（親→子・箱付き606親を登録）' },
  { type: 'set_time', label: '⑤ セット標準時間', accept: '.xlsx', hint: '梱包標準時間_セット.xlsx（品番別 分:秒）' },
];

function UploadCard({ kind }: { kind: Kind }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set('type', kind.type);
      fd.set('file', file);
      const r = await fetch('/api/master/import', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? `HTTP ${r.status}`);
      setResult(j.data as ImportResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function downloadCsv() {
    if (!result?.unmatchedCsv) return;
    const blob = new Blob([result.unmatchedCsv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `未結合_${kind.type}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-surface-base border border-surface-border rounded-lg p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-sm font-bold text-ink-strong">{kind.label}</div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded bg-brand-primary text-white font-bold hover:bg-blue-600 disabled:opacity-50"
        >
          {busy ? '取込中…' : 'ファイル選択して取込'}
        </button>
      </div>
      <div className="text-2xs text-ink-muted mb-2">{kind.hint}</div>
      <input
        ref={inputRef}
        type="file"
        accept={kind.accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) run(f);
        }}
      />

      {error && (
        <div className="text-2xs bg-status-error-bg text-status-error border border-status-error rounded p-2">
          ⚠ {error}
        </div>
      )}

      {result && (
        <div className="text-2xs space-y-1.5">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span>対象 <b className="text-ink-strong tabular-nums">{result.totalRows}</b></span>
            <span className="text-status-ok">取込 <b className="tabular-nums">{result.imported}</b></span>
            <span className="text-ink-subtle">スキップ <b className="tabular-nums">{result.skipped}</b></span>
            <span className={result.unmatched > 0 ? 'text-status-warn' : 'text-ink-subtle'}>
              未結合 <b className="tabular-nums">{result.unmatched}</b>
            </span>
          </div>
          {result.warnings.length > 0 && (
            <div className="text-status-warn">
              {result.warnings.slice(0, 5).map((w, i) => (
                <div key={i}>・{w}</div>
              ))}
              {result.warnings.length > 5 && <div>…他 {result.warnings.length - 5} 件</div>}
            </div>
          )}
          {result.unmatchedCsv && (
            <button
              onClick={downloadCsv}
              className="text-2xs px-2.5 py-1 rounded border border-accent-amber text-accent-amber hover:bg-amber-900/30"
            >
              📥 未結合 {result.unmatched} 件を CSV でダウンロード
            </button>
          )}
          {result.unmatchedSample.length > 0 && (
            <div className="overflow-x-auto">
              <table className="text-3xs border border-surface-border w-full">
                <thead className="bg-surface-panel">
                  <tr>
                    {Object.keys(result.unmatchedSample[0]).map((h) => (
                      <th key={h} className="px-1.5 py-0.5 text-left text-ink-subtle border-b border-surface-border">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.unmatchedSample.map((row, i) => (
                    <tr key={i} className="border-b border-surface-border/50">
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="px-1.5 py-0.5 text-ink truncate max-w-[160px]">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-3xs text-ink-muted mt-0.5">先頭{result.unmatchedSample.length}件のプレビュー（全件はCSV）</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MasterImportPanel() {
  return (
    <Panel>
      <PanelHeader title="🧩 基幹マスタ取込（箱・構成・標準時間）" meta="推奨順 ①→⑤" />
      <PanelBody>
        <p className="text-2xs text-ink-subtle mb-3 leading-snug">
          基幹(Thomas)由来のマスタを取り込みます。<b>①箱マスタ → ②JAN軸 → ③構成品サイズ → ④BOM → ⑤セット標準時間</b> の順がおすすめです。
          構成品サイズで未結合が出たら、CSVをダウンロードして「WMS商品コード」を記入し、③へ再アップロードすると割当てできます。
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {KINDS.map((k) => (
            <UploadCard key={k.type} kind={k} />
          ))}
        </div>
      </PanelBody>
    </Panel>
  );
}
