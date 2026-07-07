'use client';

/**
 * 検品照合グリッド（フル画面）。CraftSmile「必要製造数」画面に合わせた見せ方。
 *  - 製造部署タブ（全体＋8部署・部署カラー）は【固定表示】。データ0でも常に見える。
 *  - Excel「検品照合」の全カラム見出しは【固定表示】。商品が無くても項目は常にファーストビューで見える。
 *  - 発送予定数(①)・18時確定数(②=本日必要数)はクラフトスマイル連携値、③〜⑨はWMS実績
 *  - 引当・在庫は概念から外す（列に出さない・サイレント）
 *  - リアル表示：15秒ポーリングで自動更新
 * API: GET /api/inspection-grid?date=YYYY-MM-DD
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type GridRow = {
  productCode: string;
  productName: string | null;
  productType: string | null;
  productionDeptCode: string | null;
  productionDeptName: string | null;
  plannedQty: number;
  confirmedQty: number | null;
  prevDelivered: number;
  prevInspected: number;
  prevDiff: number;
  confirmedShortage: number | null;
  todayDelivered: number;
  todayInspected: number;
  todayDiff: number;
  totalInspected: number;
  totalDelivered: number;
  balance: number;
};

type Total = {
  skuCount: number;
  plannedQty: number;
  confirmedQty: number;
  prevDelivered: number;
  prevInspected: number;
  prevDiff: number;
  todayDelivered: number;
  todayInspected: number;
  todayDiff: number;
  totalInspected: number;
  totalDelivered: number;
  balance: number;
};

type DeptGroup = {
  deptCode: string | null;
  deptName: string | null;
  rows: GridRow[];
  subtotal: Total;
};

type GridData = {
  shipDate: string;
  depts: DeptGroup[];
  typeCounts: Record<string, number>;
  total: Total;
};

type TypeKey = 'all' | 'pass_through' | 'warehouse' | 'made_to_order';

const TYPE_LABEL: Record<Exclude<TypeKey, 'all'>, string> = {
  made_to_order: '受注生産',
  pass_through: '通過型',
  warehouse: '在庫型',
};

// 製造部署（固定・CraftSmile と同一・8部署）。データ有無に関わらずタブは常に表示。
const DEPTS: { code: string; name: string; dot: string }[] = [
  { code: 'ATELIER', name: 'アトリエ', dot: 'bg-pink-400' },
  { code: 'SANK', name: 'サンク', dot: 'bg-orange-400' },
  { code: 'SMOKE', name: '燻製', dot: 'bg-amber-400' },
  { code: 'NOODLE', name: '製麺所', dot: 'bg-indigo-400' },
  { code: 'CHOCOLAB', name: 'チョコLAB', dot: 'bg-fuchsia-400' },
  { code: 'AGRI', name: 'アグリ', dot: 'bg-emerald-400' },
  { code: 'SPC', name: 'SPC', dot: 'bg-orange-300' },
  { code: 'DELICA', name: 'デリカ', dot: 'bg-cyan-400' },
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// 全カラム（固定）。商品が無くても見出しは常に表示する。
const COLS: { key: keyof GridRow; label: string; sub?: string; accent?: string }[] = [
  { key: 'plannedQty', label: '①発送予定', sub: 'CS', accent: 'text-ink-strong' },
  { key: 'confirmedQty', label: '②18時確定', sub: '本日必要' },
  { key: 'prevDelivered', label: '③前々日前日納品' },
  { key: 'prevInspected', label: '④検品', sub: 'ハンディ' },
  { key: 'prevDiff', label: '⑤差分', sub: '③-④' },
  { key: 'confirmedShortage', label: '⑥確定締不足', sub: '②-④' },
  { key: 'todayDelivered', label: '⑦当日納品' },
  { key: 'todayInspected', label: '⑧当日検品', sub: 'ハンディ' },
  { key: 'todayDiff', label: '⑨差分', sub: '⑦-⑧' },
  { key: 'totalInspected', label: '検品合計', sub: '④+⑧' },
  { key: 'totalDelivered', label: '納品合計', sub: '③+⑦' },
  { key: 'balance', label: '過不足', sub: '納-検' },
];

const EMPTY_TOTAL: Total = {
  skuCount: 0,
  plannedQty: 0,
  confirmedQty: 0,
  prevDelivered: 0,
  prevInspected: 0,
  prevDiff: 0,
  todayDelivered: 0,
  todayInspected: 0,
  todayDiff: 0,
  totalInspected: 0,
  totalDelivered: 0,
  balance: 0,
};

export function StockMatchClient() {
  const [date, setDate] = useState(todayYmd());
  const [typeKey, setTypeKey] = useState<TypeKey>('all');
  const [diffOnly, setDiffOnly] = useState(false); // 検品差分（過不足）の出た商品だけ表示
  const [activeDept, setActiveDept] = useState<string>('__all__'); // '__all__'=全体 / deptCode
  const [data, setData] = useState<GridData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  // ①検品パターン（前々日前日 / 当日）。差分フィルタ・送信対象をこのパターンにスコープする。
  const [pattern, setPattern] = useState<'prev' | 'today'>('prev');
  // ②送信対象の行選択（productCode）。途中まで検品→選んだ行だけ送信できるようにする。
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastAutoKey = useRef<string>('');

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/inspection-grid?date=${date}`);
      const j = await r.json();
      if (!r.ok) {
        setError(j?.message ?? `HTTP ${r.status}`);
        setData(null);
        return;
      }
      setData(j.data as GridData);
      setError(null);
      const now = new Date();
      setUpdatedAt(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [date]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 差分確定→CraftSmile送信（選択した行・アクティブパターンの検品済み＋差分ありのみ）
  const confirmDiff = useCallback(async () => {
    const codes = [...selected];
    if (codes.length === 0) {
      setSendResult('❌ 送信対象の行が選択されていません（チェックを付けてください）');
      return;
    }
    const patLabel = pattern === 'today' ? '当日納品' : '前々日前日納品';
    if (
      !window.confirm(
        `${date} の【${patLabel}】検品差分を、選択した ${codes.length} 商品ぶん CraftSmile へ確定送信します。\n\n` +
          `・実送信されるのは「検品済み かつ 差分あり」の行のみ\n` +
          `・未検品／未選択の商品は CraftSmile の納品データを正として送りません\n\nよろしいですか？`,
      )
    )
      return;
    setSending(true);
    setSendResult(null);
    try {
      const r = await fetch('/api/inspection-grid/confirm-diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, pattern, productCodes: codes }),
      });
      const j = await r.json();
      setSendResult(r.ok ? `✅ ${j.message}` : `❌ ${j?.message ?? `HTTP ${r.status}`}`);
      if (r.ok) void reload();
    } catch (e) {
      setSendResult(`❌ ${String(e)}`);
    } finally {
      setSending(false);
    }
  }, [date, pattern, selected, reload]);

  // リアル表示：15秒ポーリング
  useEffect(() => {
    const id = setInterval(() => void reload(), 15000);
    return () => clearInterval(id);
  }, [reload]);

  // アクティブ部署の行（全体＝全部署結合）＋種別フィルタ。データが無ければ空配列（見出しは固定表示のまま）。
  const baseRows = useMemo(() => {
    if (!data) return [];
    let base: GridRow[];
    if (activeDept === '__all__') {
      base = data.depts.flatMap((d) => d.rows);
    } else {
      const g = data.depts.find((d) => d.deptCode === activeDept);
      base = g?.rows ?? [];
    }
    return typeKey === 'all' ? base : base.filter((r) => r.productType === typeKey);
  }, [data, activeDept, typeKey]);

  // ①検品差分あり＝アクティブパターンの差分（前々日前日=⑤ / 当日=⑨）が 0 でない行だけ。
  const hasDiff = useCallback(
    (r: GridRow) => (pattern === 'today' ? r.todayDiff !== 0 : r.prevDiff !== 0),
    [pattern],
  );
  // 送信の既定対象＝アクティブパターンで「検品済み(>0)かつ差分あり」の行。
  const isSendable = useCallback(
    (r: GridRow) =>
      pattern === 'today'
        ? r.todayInspected > 0 && r.todayDiff !== 0
        : r.prevInspected > 0 && r.prevDiff !== 0,
    [pattern],
  );
  const diffCount = useMemo(() => baseRows.filter(hasDiff).length, [baseRows, hasDiff]);
  const rows = useMemo(
    () => (diffOnly ? baseRows.filter(hasDiff) : baseRows),
    [baseRows, diffOnly, hasDiff],
  );

  // 発送日／パターンが変わったら、送信対象を既定（検品済み＋差分あり）で自動選択。
  //   同一(date,pattern)での 15 秒ポーリング再取得では選択を維持（手動チェックを消さない）。
  useEffect(() => {
    if (baseRows.length === 0) return;
    const key = `${date}|${pattern}`;
    if (lastAutoKey.current === key) return;
    lastAutoKey.current = key;
    setSelected(new Set(baseRows.filter(isSendable).map((r) => r.productCode)));
  }, [baseRows, date, pattern, isSendable]);

  const toggleRow = (code: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  const allVisibleChecked = rows.length > 0 && rows.every((r) => selected.has(r.productCode));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (rows.every((r) => n.has(r.productCode))) rows.forEach((r) => n.delete(r.productCode));
      else rows.forEach((r) => n.add(r.productCode));
      return n;
    });
  const selectedVisibleCount = useMemo(
    () => rows.filter((r) => selected.has(r.productCode)).length,
    [rows, selected],
  );

  const subtotal = useMemo(() => {
    const t: Total = { ...EMPTY_TOTAL, skuCount: rows.length };
    for (const r of rows) {
      t.plannedQty += r.plannedQty;
      t.confirmedQty += r.confirmedQty ?? 0;
      t.prevDelivered += r.prevDelivered;
      t.prevInspected += r.prevInspected;
      t.todayDelivered += r.todayDelivered;
      t.todayInspected += r.todayInspected;
      t.totalInspected += r.totalInspected;
      t.totalDelivered += r.totalDelivered;
    }
    t.prevDiff = t.prevDelivered - t.prevInspected;
    t.todayDiff = t.todayDelivered - t.todayInspected;
    t.balance = t.totalDelivered - t.totalInspected;
    return t;
  }, [rows]);

  // 部署ごとの SKU 件数（タブのバッジ用・固定タブに件数を出す）
  const countByDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data?.depts ?? []) {
      if (d.deptCode) m.set(d.deptCode, d.rows.length);
    }
    return m;
  }, [data]);

  const typeCounts = data?.typeCounts ?? {};
  const cellVal = (r: GridRow, key: keyof GridRow): number | string => {
    const v = r[key];
    if (v == null) return '—';
    return v as number;
  };
  const total = data?.total ?? EMPTY_TOTAL;

  return (
    <div>
      {/* コンテキストバー：発送日＋種別＋更新 */}
      <div className="bg-surface-base border border-surface-border rounded p-2 mb-2 flex flex-wrap gap-2 items-center text-xs">
        <span className="text-ink-subtle">発送日:</span>
        <button type="button" onClick={() => setDate((d) => shiftYmd(d, -1))} className="px-2 py-1 rounded border border-surface-border bg-surface-panel hover:border-accent-amber">◀ 前日</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-surface-panel border border-surface-border rounded px-1.5 py-1 text-xs text-ink" />
        <button type="button" onClick={() => setDate((d) => shiftYmd(d, 1))} className="px-2 py-1 rounded border border-surface-border bg-surface-panel hover:border-accent-amber">翌日 ▶</button>
        <button type="button" onClick={() => setDate(todayYmd())} className="px-2 py-1 rounded border border-surface-border bg-surface-panel hover:border-accent-amber">今日</button>

        <span className="ml-3 text-ink-subtle">種別:</span>
        <div className="inline-flex border border-surface-border rounded overflow-hidden">
          {(['all', 'made_to_order', 'pass_through', 'warehouse'] as TypeKey[]).map((k) => (
            <button key={k} type="button" onClick={() => setTypeKey(k)}
              className={`px-2 py-1 text-xs font-bold ${typeKey === k ? 'bg-accent-amber text-surface-base' : 'bg-surface-base hover:bg-surface-panel text-ink-subtle'}`}>
              {k === 'all' ? '全て' : TYPE_LABEL[k]} ({typeCounts[k] ?? 0})
            </button>
          ))}
        </div>

        {/* ①検品パターン切替（前々日前日 / 当日）。差分フィルタと送信対象をスコープ */}
        <span className="ml-3 text-ink-subtle">検品:</span>
        <div className="inline-flex border border-surface-border rounded overflow-hidden">
          {(['prev', 'today'] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPattern(p)}
              title={p === 'prev' ? '前々日前日納品(③④)の差分を対象にする' : '当日納品(⑦⑧)の差分を対象にする'}
              className={`px-2 py-1 text-xs font-bold ${pattern === p ? 'bg-accent-amber text-surface-base' : 'bg-surface-base hover:bg-surface-panel text-ink-subtle'}`}>
              {p === 'prev' ? '前々日前日' : '当日'}
            </button>
          ))}
        </div>

        {/* 検品差分のみ表示トグル（アクティブパターンの差分のみ） */}
        <button type="button" onClick={() => setDiffOnly((v) => !v)}
          title="アクティブパターン（前々日前日 or 当日）の検品差分が出た商品だけを表示"
          className={`ml-1 px-2 py-1 rounded border text-xs font-bold transition-colors ${
            diffOnly ? 'bg-status-error text-white border-status-error' : 'bg-surface-base border-surface-border text-ink-subtle hover:border-accent-amber'
          }`}>
          ⚠ 検品差分のみ ({diffCount})
        </button>

        {/* 差分を確定してCraftSmileへ送信（選択行のみ・アクティブパターン） */}
        <button type="button" onClick={confirmDiff} disabled={sending || selectedVisibleCount === 0}
          title="選択した行の検品差分（検品済み＋差分あり・アクティブパターン）を確定してCraftSmileへ送信します"
          className="ml-1 px-2 py-1 rounded border text-xs font-bold bg-blue-700 text-white border-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed">
          {sending ? '送信中…' : `📤 差分を確定して送信（${selectedVisibleCount}）`}
        </button>

        <div className="ml-auto flex items-center gap-2 text-2xs text-ink-muted">
          {updatedAt && <span>更新 {updatedAt}{busy ? '…' : ''}（自動15秒）</span>}
          <button type="button" onClick={reload} disabled={busy} className="px-2 py-1 rounded bg-surface-base border border-surface-border hover:border-accent-amber disabled:opacity-50 text-xs">🔄</button>
        </div>
      </div>

      {/* 製造部署タブ（固定・全体＋8部署）。データ有無に関わらず常に表示。 */}
      <div className="flex flex-wrap gap-1 mb-2">
        {[{ code: '__all__', name: '全体', dot: '' }, ...DEPTS].map((t) => {
          const active = activeDept === t.code;
          const cnt = t.code === '__all__' ? total.skuCount : countByDept.get(t.code) ?? 0;
          return (
            <button key={t.code} type="button" onClick={() => setActiveDept(t.code)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                active ? 'border-accent-amber bg-accent-amber text-surface-base' : 'border-surface-border bg-surface-panel text-ink-subtle hover:border-accent-amber'
              }`}>
              {t.dot && <span className={`w-2 h-2 rounded-full ${t.dot}`} />}
              {t.name}
              <span className={`text-2xs ${active ? 'text-surface-base/80' : 'text-ink-muted'}`}>({cnt})</span>
            </button>
          );
        })}
      </div>

      {error && <div className="mb-2 p-2 text-xs bg-status-error-bg text-status-error border border-status-error rounded">{error}</div>}
      {sendResult && (
        <div className="mb-2 p-2 text-xs bg-surface-panel border border-surface-border rounded text-ink-strong flex items-center justify-between gap-2">
          <span>{sendResult}</span>
          <button type="button" onClick={() => setSendResult(null)} className="text-ink-muted hover:text-ink">×</button>
        </div>
      )}

      {/* データ0件でも見出し（カラム・タブ）は固定表示。連携待ちのときだけ小さく注記。 */}
      {data && total.skuCount === 0 && !error && (
        <div className="mb-2 px-2 py-1 text-2xs text-ink-muted bg-surface-panel border border-surface-border rounded">
          ※ この発送日の発送予定データ（クラフトスマイル連携）はまだありません。WMS一括納品の送信 or 18時確定取込で表示されます。
        </div>
      )}

      {/* グリッド：カラム見出しは常に固定表示（sticky 商品列＋固定ヘッダ＋合計行固定） */}
      <div className="border border-surface-border rounded overflow-auto max-h-[calc(100vh-190px)]">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-20">
            <tr className="bg-surface-base text-ink-subtle">
              <th className="sticky left-0 z-30 bg-surface-base text-left px-2 py-1.5 border-b border-surface-border min-w-[200px]">
                <label className="inline-flex items-center gap-1.5 cursor-pointer" title="表示中の行を全選択／全解除">
                  <input type="checkbox" checked={allVisibleChecked} onChange={toggleAllVisible} className="accent-accent-amber" />
                  商品
                </label>
              </th>
              {COLS.map((c) => (
                <th key={c.key} className="text-right px-2 py-1.5 border-b border-surface-border whitespace-nowrap">
                  <div>{c.label}</div>
                  {c.sub && <div className="text-2xs font-normal text-ink-muted">{c.sub}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productCode} className="hover:bg-surface-base/60 border-b border-surface-border/60">
                <td className="sticky left-0 z-10 bg-surface-panel px-2 py-1">
                  <div className="flex items-start gap-1.5">
                    <input type="checkbox" checked={selected.has(r.productCode)} onChange={() => toggleRow(r.productCode)} className="mt-0.5 accent-accent-amber shrink-0" />
                    <div className="min-w-0">
                      <div className="text-ink-strong truncate max-w-[170px]">{r.productName ?? '—'}</div>
                      <div className="text-2xs text-ink-muted tabular-nums">
                        {r.productCode}
                        {r.productType ? `／${TYPE_LABEL[r.productType as Exclude<TypeKey, 'all'>] ?? r.productType}` : ''}
                      </div>
                    </div>
                  </div>
                </td>
                {COLS.map((c) => {
                  const raw = r[c.key];
                  let cls = 'text-right px-2 py-1 tabular-nums';
                  if (c.key === 'confirmedShortage' && raw != null && (raw as number) > 0) cls += ' text-status-error font-bold';
                  else if ((c.key === 'prevDiff' || c.key === 'todayDiff') && raw !== 0) cls += ' text-accent-amber';
                  else if (c.key === 'balance') cls += (raw as number) > 0 ? ' text-accent-amber font-bold' : (raw as number) < 0 ? ' text-status-error font-bold' : '';
                  else if (c.accent) cls += ' ' + c.accent;
                  return <td key={c.key} className={cls}>{cellVal(r, c.key)}</td>;
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} className="text-center py-10 text-ink-muted text-xs">
                  {busy ? '読込中…' : '該当する商品がありません（項目は上に固定表示）'}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="sticky bottom-0 z-20">
            <tr className="bg-surface-base font-bold text-ink-strong">
              <td className="sticky left-0 z-30 bg-surface-base px-2 py-1.5 border-t border-surface-border">合計（{subtotal.skuCount} SKU）</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">{subtotal.plannedQty}</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">{subtotal.confirmedQty}</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">{subtotal.prevDelivered}</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">{subtotal.prevInspected}</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">{subtotal.prevDiff}</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">—</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">{subtotal.todayDelivered}</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">{subtotal.todayInspected}</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">{subtotal.todayDiff}</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">{subtotal.totalInspected}</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">{subtotal.totalDelivered}</td>
              <td className="text-right px-2 py-1.5 border-t border-surface-border tabular-nums">{subtotal.balance}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
