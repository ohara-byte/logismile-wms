'use client';

/**
 * 🥇 商品ランキング サブタブ（A-Rep4）
 *
 * 既存 /api/report/product-abc を活用。
 * 累積比率付き ABC 分析（A:80% / B:95% / C:100%）。
 */

import { useEffect, useState } from 'react';
import { useReportPeriod } from './report-period-context';

interface ProductRow {
  productCode: string;
  productName: string;
  qty: number;
  jan: string | null;
}

export function ProductPane() {
  const period = useReportPeriod();
  const [items, setItems] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/product-abc?from=${period.from}&to=${period.to}&top=50`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setItems(j.data?.items ?? []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to]);

  if (loading) return <div className="p-3 text-2xs text-ink-muted">読み込み中…</div>;

  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const max = Math.max(...items.map((i) => i.qty), 1);

  // ABC 累積
  let cum = 0;
  const ranked: Array<ProductRow & { cumRate: number; klass: 'A' | 'B' | 'C' }> = items.map((it) => {
    cum += it.qty;
    const cumRate = totalQty > 0 ? cum / totalQty : 0;
    const klass: 'A' | 'B' | 'C' = cumRate <= 0.8 ? 'A' : cumRate <= 0.95 ? 'B' : 'C';
    return { ...it, cumRate, klass };
  });

  return (
    <div className="p-1 space-y-3">
      <div className="bg-surface-base border border-surface-border rounded p-2 grid grid-cols-4 gap-2 text-2xs">
        <Stat label="商品数" value={`${items.length}`} />
        <Stat label="総出荷数量" value={`${totalQty.toLocaleString()} 個`} />
        <Stat
          label="A 区分（〜80%）"
          value={`${ranked.filter((r) => r.klass === 'A').length} 商品`}
          valueCls="text-status-error"
        />
        <Stat
          label="B/C 区分"
          value={`${ranked.filter((r) => r.klass !== 'A').length} 商品`}
          valueCls="text-ink-muted"
        />
      </div>

      {items.length === 0 ? (
        <div className="p-4 text-2xs text-ink-muted text-center">
          期間内のデータがありません
        </div>
      ) : (
        <div className="border border-surface-border rounded overflow-auto max-h-[450px]">
          <table className="w-full text-2xs">
            <thead className="bg-surface-base sticky top-0 border-b border-surface-border">
              <tr>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">順</th>
                <th className="px-1.5 py-1 text-center text-3xs uppercase text-ink-subtle">区分</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">商品コード</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">商品名</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">JAN</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">数量</th>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">分布</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">累積%</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, idx) => (
                <tr key={r.productCode} className="border-t border-surface-border">
                  <td className="px-1.5 py-1 text-ink-muted tabular-nums">{idx + 1}</td>
                  <td className="px-1.5 py-1 text-center">
                    <KlassBadge klass={r.klass} />
                  </td>
                  <td className="px-1.5 py-1 font-mono">{r.productCode}</td>
                  <td className="px-1.5 py-1 truncate max-w-[260px]">{r.productName}</td>
                  <td className="px-1.5 py-1 font-mono text-ink-subtle">{r.jan ?? '—'}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums font-bold">
                    {r.qty.toLocaleString()}
                  </td>
                  <td className="px-1.5 py-1 w-[20%]">
                    <div className="h-1.5 bg-surface-panel rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-700 to-amber-300"
                        style={{ width: `${(r.qty / max) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-ink-subtle">
                    {(r.cumRate * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KlassBadge({ klass }: { klass: 'A' | 'B' | 'C' }) {
  const cls =
    klass === 'A'
      ? 'bg-red-900 text-red-100'
      : klass === 'B'
        ? 'bg-amber-900 text-amber-100'
        : 'bg-slate-700 text-slate-200';
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${cls}`}>
      {klass}
    </span>
  );
}

function Stat({
  label,
  value,
  valueCls,
}: {
  label: string;
  value: string;
  valueCls?: string;
}) {
  return (
    <div>
      <div className="text-3xs text-ink-muted">{label}</div>
      <div className={`text-base font-bold tabular-nums ${valueCls ?? 'text-ink-strong'}`}>{value}</div>
    </div>
  );
}
