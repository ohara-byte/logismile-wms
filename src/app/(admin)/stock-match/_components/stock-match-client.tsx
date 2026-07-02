'use client';

/**
 * 検品照合グリッド（フル画面）。発送日 × 製造部署 × 種別。
 *  - 母集合＝クラフトスマイル由来 FactoryShipPlan（発送予定/18時確定/製造部署）
 *  - WMS 実績（納品=inbound / 検品=inspection_count）を突合
 *  - 引当は概念から外す（列に出さない・サイレント）
 * API: GET /api/inspection-grid?date=YYYY-MM-DD
 */

import { useCallback, useEffect, useState } from 'react';

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

function pad(n: number) {
  return String(n).padStart(2, '0');
}
/** ブラウザ(JST)基準の当日 YMD */
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** YMD を ±days した YMD（ローカル基準） */
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function StockMatchClient() {
  const [date, setDate] = useState(todayYmd());
  const [typeKey, setTypeKey] = useState<TypeKey>('all');
  const [data, setData] = useState<GridData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [date]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filterRows = (rows: GridRow[]) =>
    typeKey === 'all' ? rows : rows.filter((r) => r.productType === typeKey);

  const typeCounts = data?.typeCounts ?? {};

  return (
    <div>
      {/* ツールバー */}
      <div className="bg-surface-base border border-surface-border rounded p-2 mb-2 flex flex-wrap gap-2 items-center text-2xs">
        <span className="text-ink-subtle">発送日:</span>
        <button
          type="button"
          onClick={() => setDate((d) => shiftYmd(d, -1))}
          className="px-2 py-1 rounded border border-surface-border bg-surface-panel hover:border-accent-amber"
        >
          ◀ 前日
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-surface-panel border border-surface-border rounded px-1.5 py-1 text-2xs text-ink"
        />
        <button
          type="button"
          onClick={() => setDate((d) => shiftYmd(d, 1))}
          className="px-2 py-1 rounded border border-surface-border bg-surface-panel hover:border-accent-amber"
        >
          翌日 ▶
        </button>
        <button
          type="button"
          onClick={() => setDate(todayYmd())}
          className="px-2 py-1 rounded border border-surface-border bg-surface-panel hover:border-accent-amber"
        >
          今日
        </button>

        <span className="ml-3 text-ink-subtle">種別:</span>
        <div className="inline-flex border border-surface-border rounded overflow-hidden">
          {(['all', 'made_to_order', 'pass_through', 'warehouse'] as TypeKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTypeKey(k)}
              className={`px-2.5 py-1 text-2xs font-bold ${
                typeKey === k
                  ? 'bg-accent-amber text-surface-base'
                  : 'bg-surface-base hover:bg-surface-panel text-ink-subtle'
              }`}
            >
              {k === 'all' ? '全て' : TYPE_LABEL[k]} ({typeCounts[k] ?? 0})
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={reload}
          disabled={busy}
          className="ml-auto px-3 py-1 rounded bg-surface-base border border-surface-border hover:border-accent-amber disabled:opacity-50"
        >
          🔄 更新
        </button>
      </div>

      {error && (
        <div className="mb-2 p-2 text-2xs bg-status-error-bg text-status-error border border-status-error rounded">
          {error}
        </div>
      )}

      {data && (
        <div className="mb-2 text-2xs text-ink-subtle">
          発送日 <b className="text-ink-strong">{data.shipDate}</b>／製造部署{' '}
          <b className="text-ink-strong">{data.depts.length}</b>／SKU{' '}
          <b className="text-ink-strong tabular-nums">{data.total.skuCount}</b>
          ／発送予定 <b className="tabular-nums">{data.total.plannedQty}</b>
          ／検品合計 <b className="tabular-nums">{data.total.totalInspected}</b>
          ／過不足 <b className="tabular-nums">{data.total.balance}</b>
        </div>
      )}

      {data && data.depts.length === 0 && (
        <div className="p-6 text-center text-ink-subtle text-xs border border-surface-border rounded">
          この発送日の発送予定データ（クラフトスマイル連携）がありません。
        </div>
      )}

      {data &&
        data.depts.map((g) => {
          const rows = filterRows(g.rows);
          if (rows.length === 0) return null;
          return (
            <div key={g.deptCode ?? 'none'} className="mb-4">
              <div className="text-xs font-bold text-ink-strong mb-1 px-1">
                🏭 {g.deptName ?? '（製造部署なし）'}{' '}
                <span className="text-2xs text-ink-subtle font-normal">
                  SKU {rows.length}／予定 {g.subtotal.plannedQty}／検品合計 {g.subtotal.totalInspected}
                </span>
              </div>
              <div className="border border-surface-border rounded overflow-x-auto">
                <table className="w-full text-2xs min-w-[1180px]">
                  <thead className="bg-surface-base border-b border-surface-border sticky top-0 z-10">
                    <tr className="text-ink-subtle">
                      <th className="text-left px-2 py-1">商品</th>
                      <th className="text-center px-1 py-1">種別</th>
                      <th className="text-right px-2 py-1">①発送予定</th>
                      <th className="text-right px-2 py-1">②18時確定</th>
                      <th className="text-right px-2 py-1">③前々日前日納品</th>
                      <th className="text-right px-2 py-1">④検品</th>
                      <th className="text-right px-2 py-1">⑤差分</th>
                      <th className="text-right px-2 py-1">⑥確定締不足</th>
                      <th className="text-right px-2 py-1">⑦当日納品</th>
                      <th className="text-right px-2 py-1">⑧当日検品</th>
                      <th className="text-right px-2 py-1">⑨差分</th>
                      <th className="text-right px-2 py-1">検品合計</th>
                      <th className="text-right px-2 py-1">納品合計</th>
                      <th className="text-right px-2 py-1">過不足</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.productCode} className="border-t border-surface-border hover:bg-surface-base/50">
                        <td className="px-2 py-1">
                          <div className="text-ink-strong">{r.productName ?? '—'}</div>
                          <div className="text-3xs text-ink-muted tabular-nums">{r.productCode}</div>
                        </td>
                        <td className="px-1 py-1 text-center text-3xs text-ink-subtle">
                          {r.productType ? TYPE_LABEL[r.productType as Exclude<TypeKey, 'all'>] ?? r.productType : '—'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-strong">{r.plannedQty}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.confirmedQty ?? '—'}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.prevDelivered}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.prevInspected}</td>
                        <td className={`px-2 py-1 text-right tabular-nums ${r.prevDiff !== 0 ? 'text-accent-amber' : ''}`}>
                          {r.prevDiff}
                        </td>
                        <td
                          className={`px-2 py-1 text-right tabular-nums ${
                            r.confirmedShortage != null && r.confirmedShortage > 0 ? 'text-status-error font-bold' : ''
                          }`}
                        >
                          {r.confirmedShortage ?? '—'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.todayDelivered}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.todayInspected}</td>
                        <td className={`px-2 py-1 text-right tabular-nums ${r.todayDiff !== 0 ? 'text-accent-amber' : ''}`}>
                          {r.todayDiff}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-strong">{r.totalInspected}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.totalDelivered}</td>
                        <td
                          className={`px-2 py-1 text-right tabular-nums font-bold ${
                            r.balance > 0 ? 'text-accent-amber' : r.balance < 0 ? 'text-status-error' : ''
                          }`}
                        >
                          {r.balance}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
    </div>
  );
}
