'use client';

import { useEffect, useState } from 'react';

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

  // GPシフトCSV ウィザード
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

  // マトリクス変換: staff × date
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
    <div className="space-y-6">
      {/* CSV ウィザード */}
      <div className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-3">📥 GPシフトCSV 取込（4ステップ）</h2>
        <ol className="text-xs text-gray-500 mb-3 list-decimal pl-5 space-y-0.5">
          <li>ファイル選択（社員番号 + 日付列のCSV）</li>
          <li>プレビュー（突合結果確認）</li>
          <li>差分確認</li>
          <li>実行 → shifts へ書き込み</li>
        </ol>
        <div className="flex gap-2 items-center mb-3">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            className="flex-1 text-sm"
          />
          <button
            disabled={!csvFile}
            onClick={onPreviewCsv}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm disabled:bg-gray-300"
          >
            プレビュー
          </button>
        </div>

        {preview && (
          <div className="border-t pt-3 space-y-2">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-sm">
              <Stat label="検出件数" value={preview.totalRows} />
              <Stat label="マッチ" value={preview.matched} color="green" />
              <Stat label="対象担当者" value={preview.matchedStaff} />
              <Stat
                label="未マッチ社員"
                value={preview.unmatchedEmpCodes.length}
                color={preview.unmatchedEmpCodes.length > 0 ? 'orange' : 'gray'}
              />
              <Stat
                label="不明パターン"
                value={preview.unknownPatterns.length}
                color={preview.unknownPatterns.length > 0 ? 'red' : 'gray'}
              />
            </div>
            {preview.unmatchedEmpCodes.length > 0 && (
              <div className="text-xs text-orange-700">
                未マッチ社員番号: {preview.unmatchedEmpCodes.join(', ')}
              </div>
            )}
            {preview.unknownPatterns.length > 0 && (
              <div className="text-xs text-red-700">
                不明パターン: {preview.unknownPatterns.join(', ')}（shift_patterns に登録してください）
              </div>
            )}
            <div className="text-xs text-gray-600">
              パターン別件数:{' '}
              {Object.entries(preview.patternStats)
                .map(([k, v]) => `${k}=${v}`)
                .join(' / ')}
            </div>
            <div className="text-right">
              <button
                onClick={onExecuteImport}
                disabled={executing}
                className="px-4 py-2 bg-green-600 text-white rounded font-medium disabled:bg-gray-300"
              >
                {executing ? '実行中…' : 'この内容で取込実行'}
              </button>
            </div>
          </div>
        )}
        {executeMsg && <div className="mt-2 text-sm">{executeMsg}</div>}
      </div>

      {/* シフトマトリクス */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex justify-between items-end mb-3">
          <h2 className="font-semibold">シフトマトリクス</h2>
          <div className="flex gap-2 text-xs">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border rounded px-2 py-1"
            />
            <span className="self-center">〜</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded px-2 py-1"
            />
            <button
              onClick={reload}
              disabled={busy}
              className="px-3 py-1 bg-blue-600 text-white rounded disabled:bg-gray-300"
            >
              {busy ? '…' : '表示'}
            </button>
          </div>
        </div>

        {staffCodes.length === 0 ? (
          <p className="text-center text-gray-400 py-6 text-sm">
            この期間にシフトデータがありません
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="border px-2 py-1 sticky left-0 bg-white">担当者</th>
                  {dates.map((d) => (
                    <th key={d} className="border px-2 py-1 whitespace-nowrap">
                      {d.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staffCodes.map((sc) => (
                  <tr key={sc}>
                    <td className="border px-2 py-1 sticky left-0 bg-white whitespace-nowrap">
                      {staffMap.get(sc)?.name}
                    </td>
                    {dates.map((d) => {
                      const c = cell.get(`${sc}|${d}`);
                      return (
                        <td
                          key={d}
                          className={`border px-2 py-1 text-center ${
                            c?.pattern.isOff ? 'bg-gray-100 text-gray-500' : ''
                          }`}
                        >
                          {c?.patternCode ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color = 'gray',
}: {
  label: string;
  value: number;
  color?: 'gray' | 'green' | 'red' | 'orange';
}) {
  const colorMap: Record<string, string> = {
    gray: 'text-gray-700',
    green: 'text-green-700',
    red: 'text-red-700',
    orange: 'text-orange-700',
  };
  return (
    <div className="border rounded p-2 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${colorMap[color]}`}>{value}</div>
    </div>
  );
}
