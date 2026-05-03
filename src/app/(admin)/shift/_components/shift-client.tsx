'use client';

import { useEffect, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { TextInput, FileInput } from '@/components/ui/form-controls';
import { StatCard } from '@/components/ui/stat-card';
import { cn } from '@/lib/cn';

interface ShiftItem {
  id: number;
  date: string;
  staffCode: string;
  patternCode: string;
  source: string;
  staff: { code: string; name: string; kana: string | null };
  pattern: { code: string; name: string; isOff: boolean };
}

interface PreviewData {
  totalRows: number;
  matched: number;
  matchedStaff: number;
  unmatchedEmpCodes: string[];
  unknownPatterns: string[];
  patternStats: Record<string, number>;
  payload: { date: string; staffCode: string; patternCode: string }[];
}

const todayIso = () => new Date().toISOString().slice(0, 10);
function addDays(iso: string, d: number) {
  const x = new Date(iso);
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
}

export function ShiftClient() {
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(addDays(todayIso(), 6));
  const [items, setItems] = useState<ShiftItem[]>([]);
  const [busy, setBusy] = useState(false);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executeMsg, setExecuteMsg] = useState<string | null>(null);

  async function reload() {
    setBusy(true);
    const params = new URLSearchParams({ from, to });
    const res = await fetch(`/api/shifts?${params}`);
    const j = await res.json();
    setItems(j.data?.items ?? []);
    setBusy(false);
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // マトリクス変換
  const staffMap = new Map<string, { name: string; kana: string | null }>();
  const dateSet = new Set<string>();
  for (const s of items) {
    staffMap.set(s.staffCode, { name: s.staff.name, kana: s.staff.kana });
    dateSet.add(s.date.slice(0, 10));
  }
  const dates = Array.from(dateSet).sort();
  const staffCodes = Array.from(staffMap.keys()).sort();
  const cell = new Map<string, ShiftItem>();
  for (const s of items) cell.set(`${s.staffCode}|${s.date.slice(0, 10)}`, s);

  async function onPreviewCsv() {
    if (!csvFile) return;
    setExecuteMsg(null);
    const fd = new FormData();
    fd.append('file', csvFile);
    const res = await fetch('/api/shifts/import/preview', { method: 'POST', body: fd });
    const j = await res.json();
    if (!res.ok) {
      alert(j.message ?? 'プレビュー失敗');
      return;
    }
    setPreview(j.data);
  }

  async function onExecuteImport() {
    if (!preview) return;
    setExecuting(true);
    setExecuteMsg(null);
    const res = await fetch('/api/shifts/import/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: preview.payload }),
    });
    const j = await res.json();
    setExecuting(false);
    if (!res.ok) {
      setExecuteMsg(`エラー: ${j.message ?? res.status}`);
      return;
    }
    setExecuteMsg(`✅ ${j.data.inserted} 件を登録しました`);
    setPreview(null);
    setCsvFile(null);
    reload();
  }

  return (
    <div className="space-y-3">
      {/* GP CSV ウィザード */}
      <Panel>
        <PanelHeader title="📥 GPシフトCSV 取込（4ステップ）" />
        <PanelBody className="space-y-3">
          <ol className="text-2xs text-ink-subtle list-decimal pl-5 space-y-0.5">
            <li>ファイル選択（社員番号 + 日付列のCSV）</li>
            <li>プレビュー（突合結果確認）</li>
            <li>差分確認</li>
            <li>実行 → shifts へ書き込み</li>
          </ol>
          <div className="flex gap-2 items-center">
            <FileInput
              accept=".csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
              className="flex-1"
            />
            <Button disabled={!csvFile} onClick={onPreviewCsv} size="sm">
              プレビュー
            </Button>
          </div>

          {preview && (
            <div className="border-t border-surface-border pt-3 space-y-2">
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                <StatCard label="検出件数" value={preview.totalRows} />
                <StatCard label="マッチ" value={preview.matched} tone="ok" />
                <StatCard label="対象担当者" value={preview.matchedStaff} />
                <StatCard
                  label="未マッチ社員"
                  value={preview.unmatchedEmpCodes.length}
                  tone={preview.unmatchedEmpCodes.length > 0 ? 'warn' : 'neutral'}
                />
                <StatCard
                  label="不明パターン"
                  value={preview.unknownPatterns.length}
                  tone={preview.unknownPatterns.length > 0 ? 'error' : 'neutral'}
                />
              </div>
              {preview.unmatchedEmpCodes.length > 0 && (
                <div className="text-xs text-status-warn bg-status-warn-bg border border-status-warn/40 rounded p-2">
                  未マッチ社員番号: {preview.unmatchedEmpCodes.join(', ')}
                </div>
              )}
              {preview.unknownPatterns.length > 0 && (
                <div className="text-xs text-status-error bg-status-error-bg border border-status-error/40 rounded p-2">
                  不明パターン: {preview.unknownPatterns.join(', ')}（shift_patterns に登録してください）
                </div>
              )}
              <div className="text-2xs text-ink-subtle">
                パターン別件数:{' '}
                {Object.entries(preview.patternStats)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' / ')}
              </div>
              <div className="text-right">
                <Button onClick={onExecuteImport} disabled={executing} variant="success">
                  {executing ? '実行中…' : 'この内容で取込実行'}
                </Button>
              </div>
            </div>
          )}
          {executeMsg && (
            <div className="text-xs text-ink mt-2">
              {executeMsg}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* マトリクス */}
      <Panel>
        <PanelHeader
          title="シフトマトリクス"
          action={
            <div className="flex gap-2 items-center text-2xs">
              <TextInput
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="!w-auto"
              />
              <span className="text-ink-muted">〜</span>
              <TextInput
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="!w-auto"
              />
              <Button onClick={reload} disabled={busy} size="sm">
                {busy ? '…' : '表示'}
              </Button>
            </div>
          }
        />
        <PanelBody scroll className="overflow-x-auto">
          {staffCodes.length === 0 ? (
            <p className="text-center text-ink-muted py-8 text-sm">
              この期間にシフトデータがありません
            </p>
          ) : (
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="border border-surface-border px-2 py-1 sticky left-0 bg-surface-base text-ink-subtle text-2xs">
                    担当者
                  </th>
                  {dates.map((d) => (
                    <th
                      key={d}
                      className="border border-surface-border px-2 py-1 whitespace-nowrap bg-surface-base text-ink-subtle text-2xs"
                    >
                      {d.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staffCodes.map((sc) => (
                  <tr key={sc}>
                    <td className="border border-surface-border px-2 py-1 sticky left-0 bg-surface-panel whitespace-nowrap text-ink-strong">
                      {staffMap.get(sc)?.name}
                    </td>
                    {dates.map((d) => {
                      const c = cell.get(`${sc}|${d}`);
                      const off = c?.pattern.isOff;
                      return (
                        <td
                          key={d}
                          className={cn(
                            'border border-surface-border px-2 py-1 text-center font-mono tabular-nums',
                            off
                              ? 'bg-surface-base text-ink-muted'
                              : c
                                ? 'text-accent-amber'
                                : 'text-ink-muted',
                          )}
                        >
                          {c?.patternCode ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
