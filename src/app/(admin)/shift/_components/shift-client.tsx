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
  staff: {
    code: string;
    name: string;
    kana: string | null;
    employmentTypeCode: string | null;
    groupId: string | null;
  };
  pattern: {
    code: string;
    name: string;
    isOff: boolean;
    startTime: string | null;
    endTime: string | null;
  };
}

interface PreviewData {
  totalRows: number;
  matched: number;
  matchedStaff: number;
  unmatchedEmpCodes: string[];
  unmatchedDetails?: Array<{
    empCode: string;
    name: string;
    employmentName: string | null;
    rowCount: number;
  }>;
  unknownPatterns: string[];
  patternStats: Record<string, number>;
  payload: { date: string; staffCode: string; patternCode: string }[];
  autoCreatableStaff?: Array<{
    empCode: string;
    name: string;
    employmentTypeCode: string | null;
  }>;
  dateRange?: { from: string | null; to: string | null };
}

const todayIso = () => new Date().toISOString().slice(0, 10);

interface StaffMeta {
  name: string;
  empCode: string;
  employmentTypeName: string;
  groupId: string | null;
}

export function ShiftClient() {
  const [from, setFrom] = useState('2026-04-16');
  const [to, setTo] = useState('2026-05-15');
  const [items, setItems] = useState<ShiftItem[]>([]);
  const [staffMeta, setStaffMeta] = useState<Map<string, StaffMeta>>(new Map());
  const [, setBusy] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executeMsg, setExecuteMsg] = useState<string | null>(null);
  // J-3: 未マッチ社員を自動登録するチェック（既定 true）
  const [createMissingStaff, setCreateMissingStaff] = useState(true);

  // M-2: ガント反映の挙動
  const [applyingToGantt, setApplyingToGantt] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  async function applyToGantt() {
    setApplyingToGantt(true);
    setApplyMsg(null);
    try {
      const r = await fetch('/api/assignments/init-from-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: todayIso() }),
      });
      const j = await r.json();
      if (!r.ok) {
        setApplyMsg(`⚠ ${j.message ?? `エラー: ${r.status}`}`);
      } else {
        setApplyMsg(
          `✅ 本日のシフトをガント割当のベースに反映しました。出勤予定 ${j.data?.workCount ?? 0} 名 → 未設定プールに配置済`,
        );
      }
    } catch (e) {
      setApplyMsg(`⚠ ${(e as Error).message}`);
    } finally {
      setApplyingToGantt(false);
    }
  }

  async function reload() {
    setBusy(true);
    const params = new URLSearchParams({ from, to });
    const [shiftRes, staffRes, groupRes, empTypeRes] = await Promise.all([
      fetch(`/api/shifts?${params}`).then((r) => r.json()),
      fetch('/api/master/staff').then((r) => r.json()),
      fetch('/api/master/groups').then((r) => r.json()),
      fetch('/api/master/employment-types').then((r) => r.json()).catch(() => ({ data: { items: [] } })),
    ]);
    setItems(shiftRes.data?.items ?? []);
    // 担当者メタ（emp_code, employmentTypeName）を構築
    const empTypeMap = new Map<string, string>();
    for (const t of (empTypeRes.data?.items ?? []) as Array<{ code: string; name: string }>) {
      empTypeMap.set(t.code, t.name);
    }
    const meta = new Map<string, StaffMeta>();
    for (const s of (staffRes.data?.items ?? []) as Array<{
      code: string;
      empCode: string;
      name: string;
      employmentTypeCode: string | null;
      groupId: string | null;
    }>) {
      meta.set(s.code, {
        name: s.name,
        empCode: s.empCode ?? '—',
        employmentTypeName: s.employmentTypeCode ? empTypeMap.get(s.employmentTypeCode) ?? s.employmentTypeCode : '—',
        groupId: s.groupId,
      });
    }
    setStaffMeta(meta);
    setGroups(groupRes.data?.items ?? []);
    setBusy(false);
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // マトリクス変換 — シフトデータから担当者・日付の集合を構築
  const staffSet = new Set<string>();
  const dateSet = new Set<string>();
  for (const s of items) {
    staffSet.add(s.staffCode);
    dateSet.add(s.date.slice(0, 10));
  }
  const dates = Array.from(dateSet).sort();
  // 所属フィルタ
  let staffCodes = Array.from(staffSet);
  if (groupFilter !== 'all') {
    staffCodes = staffCodes.filter((c) => staffMeta.get(c)?.groupId === groupFilter);
  }
  staffCodes.sort((a, b) => {
    const ma = staffMeta.get(a)?.empCode ?? a;
    const mb = staffMeta.get(b)?.empCode ?? b;
    return ma.localeCompare(mb);
  });
  const cell = new Map<string, ShiftItem>();
  for (const s of items) cell.set(`${s.staffCode}|${s.date.slice(0, 10)}`, s);

  // KPI 統計（モック L8504-8510 準拠）
  const totalRows = items.length;
  const workDays = items.filter((s) => !s.pattern.isOff).length;
  const offDays = totalRows - workDays;
  const targetMembers = staffSet.size;
  const targetDays = dates.length;

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
    if (!preview || !csvFile) return;
    setExecuting(true);
    setExecuteMsg(null);
    // J-2: 自動登録モードのときは file 一括 (multipart) で送って、
    // staff を作成してから当該社員のシフトも含めて取込する。
    // 既存社員のみで取込みたい場合（チェック OFF）も同じく multipart で安全に処理。
    const fd = new FormData();
    fd.append('file', csvFile);
    fd.append('createMissingStaff', String(createMissingStaff));
    const res = await fetch('/api/shifts/import/execute', {
      method: 'POST',
      body: fd,
    });
    const j = await res.json();
    setExecuting(false);
    if (!res.ok) {
      setExecuteMsg(`エラー: ${j.message ?? res.status}`);
      return;
    }
    const created = j.data?.createdStaff ?? 0;
    const inserted = j.data?.inserted ?? 0;
    setExecuteMsg(
      `✅ シフト ${inserted} 件を登録しました${
        created > 0 ? ` ／ 担当者 ${created} 名を新規登録` : ''
      }`,
    );
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
                <StatCard label="検出行数" value={preview.totalRows} />
                <StatCard label="既存マッチ" value={preview.matched} tone="ok" />
                <StatCard label="既存担当者" value={preview.matchedStaff} />
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
              {/* 未マッチ社員 詳細リスト + 自動登録チェック (J-3) */}
              {preview.unmatchedDetails && preview.unmatchedDetails.length > 0 && (
                <div className="bg-amber-950/30 border border-status-warn/40 rounded p-2 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="createMissingStaff"
                      checked={createMissingStaff}
                      onChange={(e) => setCreateMissingStaff(e.target.checked)}
                      className="mt-0.5"
                    />
                    <label htmlFor="createMissingStaff" className="text-xs text-status-warn cursor-pointer">
                      <b>未マッチ社員 {preview.unmatchedDetails.length} 名を担当者マスタへ自動登録する</b>
                      <div className="text-3xs text-ink-subtle mt-0.5">
                        従業員コードと氏名を CSV から取り込み、担当者マスタに新規追加します。
                        雇用区分はマスタと突合し、合致するものは自動セット（合致しない場合は未設定で登録）。
                        登録された社員のシフトも同時に取り込まれます。
                      </div>
                    </label>
                  </div>
                  <div className="border border-status-warn/30 rounded overflow-hidden text-2xs">
                    <table className="w-full">
                      <thead className="bg-amber-950/50">
                        <tr>
                          <th className="px-2 py-1 text-left text-3xs uppercase text-amber-200">従業員コード</th>
                          <th className="px-2 py-1 text-left text-3xs uppercase text-amber-200">氏名</th>
                          <th className="px-2 py-1 text-left text-3xs uppercase text-amber-200">雇用区分</th>
                          <th className="px-2 py-1 text-right text-3xs uppercase text-amber-200">CSV 行数</th>
                          <th className="px-2 py-1 text-center text-3xs uppercase text-amber-200">マッチ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.unmatchedDetails.map((u) => {
                          const auto = preview.autoCreatableStaff?.find((a) => a.empCode === u.empCode);
                          const matched = !!auto?.employmentTypeCode;
                          return (
                            <tr key={u.empCode} className="border-t border-amber-700/30">
                              <td className="px-2 py-1 font-mono text-amber-100">{u.empCode}</td>
                              <td className="px-2 py-1 text-ink">{u.name}</td>
                              <td className="px-2 py-1 text-ink-subtle">
                                {u.employmentName ?? '—'}
                                {auto?.employmentTypeCode && (
                                  <span className="ml-1 text-3xs text-status-ok">→ {auto.employmentTypeCode}</span>
                                )}
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums">{u.rowCount}</td>
                              <td className="px-2 py-1 text-center">
                                {matched ? (
                                  <span className="text-status-ok">✓</span>
                                ) : (
                                  <span className="text-status-warn">未</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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

      {/* M-1: モック準拠 ツールバー */}
      <div className="bg-surface-panel border border-surface-border rounded p-2 flex flex-wrap items-center gap-2">
        <span className="text-2xs text-ink-subtle">期間:</span>
        <TextInput
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="!w-auto text-xs"
        />
        <span className="text-2xs text-ink-muted">〜</span>
        <TextInput
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="!w-auto text-xs"
        />
        <span className="text-2xs text-ink-subtle ml-2">所属:</span>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="bg-surface-base border border-surface-border-strong rounded px-2 py-1 text-xs text-ink"
        >
          <option value="all">全所属</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => document.getElementById('gp-csv-input')?.scrollIntoView({ behavior: 'smooth' })}
          className="px-3 py-1.5 text-xs font-bold rounded bg-orange-900 hover:bg-orange-800 border border-orange-600 text-white"
        >
          📁 GPシフトCSV取込
        </button>
        <button
          onClick={() => alert('シフト CSV 出力（未実装）')}
          className="px-3 py-1.5 text-xs font-bold rounded bg-emerald-900 hover:bg-emerald-800 border border-emerald-700 text-white"
        >
          ⬇ CSV出力
        </button>
        <button
          onClick={applyToGantt}
          disabled={applyingToGantt}
          className="px-3 py-1.5 text-xs font-bold rounded bg-purple-700 hover:bg-purple-600 border border-purple-400 text-white disabled:opacity-50"
        >
          {applyingToGantt ? '反映中…' : '⚡ 当日のシフトをガント割当のベースに反映'}
        </button>
      </div>

      {applyMsg && (
        <div className="bg-purple-950/30 border border-purple-700/40 rounded p-2 text-2xs text-purple-200">
          {applyMsg}
        </div>
      )}

      {/* M-1: 5 つの KPI 統計 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <ShiftStat tone="blue" label="取込件数（行）" value={totalRows} unit="行" />
        <ShiftStat tone="green" label="出勤予定（行）" value={workDays} unit="行" />
        <ShiftStat tone="orange" label="休み（公/有/希休等）" value={offDays} unit="行" />
        <ShiftStat tone="violet" label="対象メンバー" value={targetMembers} unit="名" />
        <ShiftStat tone="cyan" label="対象日数" value={targetDays} unit="日" />
      </div>

      {/* M-1: シフトマトリクス（モック準拠） */}
      <div className="bg-slate-950 border border-surface-border rounded-md overflow-auto max-h-[calc(100vh-360px)]">
        {staffCodes.length === 0 ? (
          <p className="text-center text-ink-muted py-8 text-sm">
            この期間にシフトデータがありません
          </p>
        ) : (
          <table className="text-2xs border-collapse w-max min-w-full">
            <thead>
              <tr>
                <th
                  className="sticky left-0 top-0 z-30 bg-blue-950 text-blue-200 border border-blue-900 px-2 py-1 text-left font-semibold"
                  style={{ minWidth: 140 }}
                >
                  担当者（従業員#）
                </th>
                {dates.map((d) => {
                  const wkd = new Date(d).getDay();
                  const isWeekend = wkd === 0 || wkd === 6;
                  const wlabel = ['日', '月', '火', '水', '木', '金', '土'][wkd];
                  return (
                    <th
                      key={d}
                      className={`sticky top-0 z-20 border px-1 py-1 text-center font-semibold ${
                        isWeekend
                          ? 'bg-red-950 text-red-200 border-red-900'
                          : 'bg-blue-950 text-blue-200 border-blue-900'
                      }`}
                      style={{ minWidth: 60 }}
                    >
                      {d.slice(5)}
                      <br />
                      <span className="font-normal text-[9px]">{wlabel}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {staffCodes.map((sc) => {
                const meta = staffMeta.get(sc);
                return (
                  <tr key={sc} className="hover:bg-slate-900">
                    <td
                      className="sticky left-0 z-10 bg-surface-panel border border-surface-border px-2 py-1 text-left text-ink-strong font-bold"
                      style={{ minWidth: 140 }}
                    >
                      {meta?.name ?? sc}
                      <br />
                      <small className="text-[9px] text-ink-muted font-normal">
                        #{meta?.empCode ?? '—'} ／ {meta?.employmentTypeName ?? '—'}
                      </small>
                    </td>
                    {dates.map((d) => {
                      const c = cell.get(`${sc}|${d}`);
                      return (
                        <td
                          key={d}
                          className="border border-slate-800 p-0 align-middle text-center"
                          style={{ minWidth: 60, height: 28 }}
                        >
                          <ShiftCell shift={c} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap gap-2 text-3xs text-ink-muted">
        💡 凡例:
        <LegendChip variant="work" pat="G7" /> 出勤
        <LegendChip variant="off" pat="公休" /> 公休
        <LegendChip variant="yuukyu" pat="有休" /> 有給
        <LegendChip variant="kibou" pat="希休" /> 希望休
        <LegendChip variant="tokkyu" pat="特休" /> 特別
        <LegendChip variant="kekkin" pat="欠勤" /> 欠勤
        <span className="text-ink-subtle">／</span>
        <span className="text-accent-amber">
          ⚡ 当日のシフトをガント割当のベースに反映 — 本日の出勤者を未設定プールへ自動配置
        </span>
      </div>
    </div>
  );
}

/* ====== モック準拠の補助コンポーネント群 ====== */

const SHIFT_STAT_TONE: Record<'blue' | 'green' | 'orange' | 'violet' | 'cyan', string> = {
  blue: 'border-l-blue-500',
  green: 'border-l-emerald-500',
  orange: 'border-l-orange-500',
  violet: 'border-l-purple-500',
  cyan: 'border-l-cyan-500',
};

function ShiftStat({
  tone,
  label,
  value,
  unit,
}: {
  tone: keyof typeof SHIFT_STAT_TONE;
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div
      className={cn(
        'bg-surface-panel border border-surface-border border-l-4 rounded p-2',
        SHIFT_STAT_TONE[tone],
      )}
    >
      <div className="text-3xs text-ink-muted">{label}</div>
      <div className="text-lg font-bold text-ink-strong tabular-nums leading-tight mt-0.5">
        {value.toLocaleString()}
        <span className="text-2xs text-ink-muted ml-1 font-normal">{unit}</span>
      </div>
    </div>
  );
}

/** モック準拠の色分けセル（shift-work / shift-off / shift-yuukyu / shift-kibou / shift-tokkyu / shift-kekkin） */
function ShiftCell({ shift }: { shift: ShiftItem | undefined }) {
  if (!shift) {
    return (
      <span className="block text-[10px] py-1 text-slate-600">―</span>
    );
  }
  const p = shift.pattern.code;
  const name = shift.pattern.name;
  const isWork = !shift.pattern.isOff && shift.pattern.startTime && shift.pattern.endTime;
  const variant: LegendVariant = isWork
    ? 'work'
    : p.includes('有休') || name.includes('有休')
      ? 'yuukyu'
      : p.includes('希休') || name.includes('希休')
        ? 'kibou'
        : p.includes('特休') || name.includes('特休')
          ? 'tokkyu'
          : p.includes('欠勤') || name.includes('欠勤')
            ? 'kekkin'
            : 'off';

  const cls = LEGEND_VARIANT[variant];
  const tm = isWork ? `${shift.pattern.startTime}〜${shift.pattern.endTime}` : '';

  return (
    <span className={cn('block w-full leading-tight rounded-sm py-0.5 px-1', cls)}>
      <span className="font-bold text-[10px]">{p}</span>
      {tm && <span className="block text-[8px] opacity-75">{tm}</span>}
    </span>
  );
}

type LegendVariant = 'work' | 'off' | 'yuukyu' | 'kibou' | 'tokkyu' | 'kekkin';

const LEGEND_VARIANT: Record<LegendVariant, string> = {
  work: 'bg-emerald-950 text-emerald-200',
  off: 'bg-slate-800 text-slate-400',
  yuukyu: 'bg-amber-950 text-amber-200',
  kibou: 'bg-indigo-950 text-violet-200',
  tokkyu: 'bg-pink-950 text-pink-200',
  kekkin: 'bg-red-950 text-red-200 font-bold',
};

function LegendChip({ variant, pat }: { variant: LegendVariant; pat: string }) {
  return (
    <span className={cn('inline-block px-2 py-0.5 rounded-sm text-[10px] font-bold', LEGEND_VARIANT[variant])}>
      {pat}
    </span>
  );
}
