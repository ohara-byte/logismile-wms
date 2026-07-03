'use client';

/**
 * 検品照合グリッド（フル画面）。CraftSmile「必要製造数」画面に合わせた見せ方。
 *  - 製造部署タブ（全体＋各部署・部署カラー）で切り分け（必須）
 *  - Excel「検品照合」の全列をファーストビュー表示（sticky 商品列＋固定ヘッダ・トグルで隠さない）
 *  - 発送予定数(①)・18時確定数(②=本日必要数)はクラフトスマイル連携値、③〜⑨はWMS実績
 *  - 引当・在庫は概念から外す（列に出さない・サイレント）
 *  - リアル表示：15秒ポーリングで自動更新
 * API: GET /api/inspection-grid?date=YYYY-MM-DD
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

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

// 製造部署カラー（CraftSmile と同系統・タブのアクセント用）
const DEPT_DOT: Record<string, string> = {
  ATELIER: 'bg-pink-400',
  SANK: 'bg-orange-400',
  SMOKE: 'bg-amber-400',
  NOODLE: 'bg-indigo-400',
  CHOCOLAB: 'bg-fuchsia-400',
  AGRI: 'bg-emerald-400',
  SPC: 'bg-orange-300',
  DELICA: 'bg-cyan-400',
};

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

export function StockMatchClient() {
  const [date, setDate] = useState(todayYmd());
  const [typeKey, setTypeKey] = useState<TypeKey>('all');
  const [activeDept, setActiveDept] = useState<string>('__all__'); // '__all__'=全体 / deptCode / '__none__'
  const [data, setData] = useState<GridData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>('');

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

  // リアル表示：15秒ポーリング
  useEffect(() => {
    const id = setInterval(() => void reload(), 15000);
    return () => clearInterval(id);
  }, [reload]);

  // 部署タブ（全体＋データにある部署）
  const deptTabs = useMemo(() => {
    const tabs: { code: string; label: string; deptCode: string | null }[] = [
      { code: '__all__', label: '全体', deptCode: null },
    ];
    for (const d of data?.depts ?? []) {
      tabs.push({
        code: d.deptCode ?? '__none__',
        label: d.deptName ?? '（部署なし）',
        deptCode: d.deptCode,
      });
    }
    return tabs;
  }, [data]);

  // アクティブ部署の行（全体＝全部署結合）＋種別フィルタ
  const rows = useMemo(() => {
    if (!data) return [];
    let base: GridRow[];
    if (activeDept === '__all__') {
      base = data.depts.flatMap((d) => d.rows);
    } else {
      const g = data.depts.find((d) => (d.deptCode ?? '__none__') === activeDept);
      base = g?.rows ?? [];
    }
    return typeKey === 'all' ? base : base.filter((r) => r.productType === typeKey);
  }, [data, activeDept, typeKey]);

  const subtotal = useMemo(() => {
    const t: Total = {
      skuCount: rows.length,
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

  const typeCounts = data?.typeCounts ?? {};
  const cellVal = (r: GridRow, key: keyof GridRow): number | string => {
    const v = r[key];
    if (v == null) return '—';
    return v as number;
  };

  return (
    <div>
      {/* コンテキストバー：発送日＋種別＋更新 */}
      <div className="bg-surface-base border border-surface-border rounded p-2 mb-2 flex flex-wrap gap-2 items-center text-2xs">
        <span className="text-ink-subtle">発送日:</span>
        <button type="button" onClick={() => setDate((d) => shiftYmd(d, -1))} className="px-2 py-1 rounded border border-surface-border bg-surface-panel hover:border-accent-amber">◀ 前日</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-surface-panel border border-surface-border rounded px-1.5 py-1 text-2xs text-ink" />
        <button type="button" onClick={() => setDate((d) => shiftYmd(d, 1))} className="px-2 py-1 rounded border border-surface-border bg-surface-panel hover:border-accent-amber">翌日 ▶</button>
        <button type="button" onClick={() => setDate(todayYmd())} className="px-2 py-1 rounded border border-surface-border bg-surface-panel hover:border-accent-amber">今日</button>

        <span className="ml-3 text-ink-subtle">種別:</span>
        <div className="inline-flex border border-surface-border rounded overflow-hidden">
          {(['all', 'made_to_order', 'pass_through', 'warehouse'] as TypeKey[]).map((k) => (
            <button key={k} type="button" onClick={() => setTypeKey(k)}
              className={`px-2 py-1 text-2xs font-bold ${typeKey === k ? 'bg-accent-amber text-surface-base' : 'bg-surface-base hover:bg-surface-panel text-ink-subtle'}`}>
              {k === 'all' ? '全て' : TYPE_LABEL[k]} ({typeCounts[k] ?? 0})
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 text-3xs text-ink-muted">
          {updatedAt && <span>更新 {updatedAt}{busy ? '…' : ''}（自動15秒）</span>}
          <button type="button" onClick={reload} disabled={busy} className="px-2 py-1 rounded bg-surface-base border border-surface-border hover:border-accent-amber disabled:opacity-50 text-2xs">🔄</button>
        </div>
      </div>

      {/* 製造部署タブ（必須・全体＋各部署） */}
      <div className="flex flex-wrap gap-1 mb-2">
        {deptTabs.map((t) => {
          const active = activeDept === t.code;
          const dot = t.deptCode ? DEPT_DOT[t.deptCode] : null;
          return (
            <button key={t.code} type="button" onClick={() => setActiveDept(t.code)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-2xs font-bold transition-colors ${
                active ? 'border-accent-amber bg-accent-amber text-surface-base' : 'border-surface-border bg-surface-panel text-ink-subtle hover:border-accent-amber'
              }`}>
              {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
              {t.label}
            </button>
          );
        })}
      </div>

      {error && <div className="mb-2 p-2 text-2xs bg-status-error-bg text-status-error border border-status-error rounded">{error}</div>}

      {data && data.depts.length === 0 && (
        <div className="p-6 text-center text-ink-subtle text-xs border border-surface-border rounded">
          この発送日の発送予定データ（クラフトスマイル連携）がありません。WMS一括納品の送信 or 18時確定取込で連携されます。
        </div>
      )}

      {/* グリッド：全列ファーストビュー・sticky 商品列＋固定ヘッダ */}
      {data && data.depts.length > 0 && (
        <div className="border border-surface-border rounded overflow-auto max-h-[calc(100vh-190px)]">
          <table className="w-full text-2xs border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="bg-surface-base text-ink-subtle">
                <th className="sticky left-0 z-30 bg-surface-base text-left px-2 py-1.5 border-b border-surface-border min-w-[200px]">商品</th>
                {COLS.map((c) => (
                  <th key={c.key} className="text-right px-2 py-1.5 border-b border-surface-border whitespace-nowrap">
                    <div>{c.label}</div>
                    {c.sub && <div className="text-3xs font-normal text-ink-muted">{c.sub}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productCode} className="hover:bg-surface-base/60 border-b border-surface-border/60">
                  <td className="sticky left-0 z-10 bg-surface-panel px-2 py-1">
                    <div className="text-ink-strong truncate max-w-[190px]">{r.productName ?? '—'}</div>
                    <div className="text-3xs text-ink-muted tabular-nums">
                      {r.productCode}
                      {r.productType ? `／${TYPE_LABEL[r.productType as Exclude<TypeKey, 'all'>] ?? r.productType}` : ''}
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
                  <td colSpan={COLS.length + 1} className="text-center py-6 text-ink-muted text-2xs">該当データがありません</td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
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
            )}
          </table>
        </div>
      )}
    </div>
  );
}
