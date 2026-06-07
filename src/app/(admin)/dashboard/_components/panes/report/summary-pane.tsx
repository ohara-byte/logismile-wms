'use client';

/**
 * 📊 サマリー（日別） サブタブ（A-Rep1）
 *
 * モック準拠（管理用PCモック_v0.22.html L3562-3700）。
 *
 * - 期間 KPI 8 枚
 * - 日別推移チャート（簡易）
 * - 日別明細テーブル
 *
 * 既存 /api/report/summary を活用。
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useReportPeriod } from './report-period-context';
import { KpiDrillModal, type DrillCell } from './kpi-drill-modal';

interface Daily {
  date: string;
  shipped: number;
  packed: number;
  packMin: number;
  manHours: number;
  forceOk: number;
  staffCount: number;
  weekday: string;
}

interface SummaryData {
  daily: Daily[];
  total: {
    shipped: number;
    packed: number;
    packMin: number;
    manHours: number;
    forceOk: number;
  };
  avg: {
    perDay: number;
    perOrderMin: number;
  };
  best: { date: string; shipped: number };
  worst: { date: string; shipped: number };
}

// Sprint Z-6: 商品集計（/api/report/product-abc から）
interface ProductTopRow {
  productCode: string;
  productName: string;
  totalQty: number;
  orderCount: number;
  abc?: 'A' | 'B' | 'C';
  cumRatio?: number;
}

type DrillKey = 'totalShip' | 'totalPackTime' | 'totalCompleteTime' | 'totalMH' | null;

interface DrillState {
  loading: boolean;
  errorMsg: string | null;
  cols: string[];
  rows: DrillCell[][];
  codeFirstCol?: boolean;
}

const EMPTY_DRILL: DrillState = { loading: false, errorMsg: null, cols: [], rows: [] };

export function SummaryPane() {
  const router = useRouter();
  const period = useReportPeriod();
  const [data, setData] = useState<SummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // A-1〜A-5: ドリルダウンモーダル状態
  const [drillKey, setDrillKey] = useState<DrillKey>(null);
  const [drill, setDrill] = useState<DrillState>(EMPTY_DRILL);

  // Task B: 日別明細の行クリックで該当日の伝票一覧モーダルを開く
  const [dayDrill, setDayDrill] = useState<{ date: string; weekday: string } | null>(null);
  const [dayDrillState, setDayDrillState] = useState<DrillState>(EMPTY_DRILL);

  // Sprint Z-6: 商品集計（top 10 + 全体集計）
  const [productTop, setProductTop] = useState<ProductTopRow[]>([]);
  const [productLoading, setProductLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/summary?from=${period.from}&to=${period.to}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.data) setData(j.data);
        else setError(j.message ?? 'データ取得に失敗');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to]);

  // Sprint Z-6: 商品集計を期間と同期で取得
  useEffect(() => {
    let cancelled = false;
    setProductLoading(true);
    fetch(`/api/report/product-abc?from=${period.from}&to=${period.to}&top=500`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setProductTop((j.data?.items ?? []) as ProductTopRow[]);
      })
      .catch(() => {
        if (!cancelled) setProductTop([]);
      })
      .finally(() => !cancelled && setProductLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to]);

  // ドリルダウンを開いたら API を叩いてテーブルに流し込む
  useEffect(() => {
    if (!drillKey) return;
    let cancelled = false;
    setDrill({ loading: true, errorMsg: null, cols: [], rows: [] });

    async function load() {
      try {
        if (drillKey === 'totalShip') {
          const r = await fetch(
            `/api/report/drill/total-ship?from=${period.from}&to=${period.to}&limit=100`,
          );
          const j = await r.json();
          if (cancelled) return;
          if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
          const items: Array<{
            pkNo: string;
            destName: string;
            carrier: string;
            itemCount: number;
            shipDate: string;
            statusLabel: string;
          }> = j.data?.items ?? [];
          setDrill({
            loading: false,
            errorMsg: null,
            cols: ['伝票No', '配送先', '配送便', '明細', '日付', '状態'],
            rows: items.map((it) => [
              it.pkNo,
              it.destName,
              it.carrier,
              it.itemCount,
              it.shipDate,
              it.statusLabel,
            ]),
            codeFirstCol: true,
          });
        } else if (drillKey === 'totalPackTime') {
          const r = await fetch(
            `/api/report/drill/total-pack-time?from=${period.from}&to=${period.to}&limit=100`,
          );
          const j = await r.json();
          if (cancelled) return;
          if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
          const items: Array<{
            pkNo: string;
            destName: string;
            staffName: string;
            itemCount: number;
            durationMin: string;
            completedAt: string;
          }> = j.data?.items ?? [];
          setDrill({
            loading: false,
            errorMsg: null,
            cols: ['伝票No', '配送先', '担当者', '明細', '所要(分)', '完了時刻'],
            rows: items.map((it) => [
              it.pkNo,
              it.destName,
              it.staffName,
              it.itemCount,
              it.durationMin,
              it.completedAt,
            ]),
            codeFirstCol: true,
          });
        } else if (drillKey === 'totalCompleteTime') {
          const r = await fetch(
            `/api/report/drill/total-complete-time?from=${period.from}&to=${period.to}`,
          );
          const j = await r.json();
          if (cancelled) return;
          if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
          const items: Array<{
            date: string;
            weekday: string;
            lastCompleted: string;
            count: number;
          }> = j.data?.items ?? [];
          setDrill({
            loading: false,
            errorMsg: null,
            cols: ['日付', '曜', '最終完了時刻', '完了件数'],
            rows: items.map((it) => [it.date, it.weekday, it.lastCompleted, it.count]),
          });
        } else if (drillKey === 'totalMH') {
          const r = await fetch(
            `/api/report/staff-mh?from=${period.from}&to=${period.to}`,
          );
          const j = await r.json();
          if (cancelled) return;
          if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
          const items: Array<{
            staffCode: string;
            staffName: string;
            count: number;
            mhHours: number;
            avgSec: number;
          }> = j.data?.items ?? [];
          setDrill({
            loading: false,
            errorMsg: null,
            cols: ['コード', '担当者', 'MH(人時)', '処理件数', '平均(秒/件)'],
            rows: items.map((it) => [
              it.staffCode,
              it.staffName,
              it.mhHours.toFixed(1),
              it.count,
              it.avgSec,
            ]),
            codeFirstCol: true,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setDrill({
            loading: false,
            errorMsg: e instanceof Error ? e.message : String(e),
            cols: [],
            rows: [],
          });
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [drillKey, period.from, period.to]);

  // Task B: 日別ドリルの fetch（指定日 1 日の伝票一覧）
  useEffect(() => {
    if (!dayDrill) return;
    let cancelled = false;
    setDayDrillState({ loading: true, errorMsg: null, cols: [], rows: [] });
    (async () => {
      try {
        const r = await fetch(
          `/api/report/drill/total-ship?from=${dayDrill.date}&to=${dayDrill.date}&limit=200`,
        );
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
        const items: Array<{
          pkNo: string;
          destName: string;
          carrier: string;
          itemCount: number;
          shipDate: string;
          statusLabel: string;
        }> = j.data?.items ?? [];
        setDayDrillState({
          loading: false,
          errorMsg: null,
          cols: ['伝票No', '配送先', '配送便', '明細', '日付', '状態'],
          rows: items.map((it) => [
            it.pkNo,
            it.destName,
            it.carrier,
            it.itemCount,
            it.shipDate,
            it.statusLabel,
          ]),
          codeFirstCol: true,
        });
      } catch (e) {
        if (!cancelled) {
          setDayDrillState({
            loading: false,
            errorMsg: e instanceof Error ? e.message : String(e),
            cols: [],
            rows: [],
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayDrill]);

  if (loading || !data) {
    return (
      <div className="p-3 text-2xs text-ink-muted">
        {error ? `⚠ ${error}` : '読み込み中…'}
      </div>
    );
  }

  // I-3b: API レスポンスが想定外でもクラッシュしないよう、各ブロックを安全に取り出す
  const daily = data.daily ?? [];
  const total = data.total ?? { shipped: 0, packed: 0, packMin: 0, manHours: 0, forceOk: 0 };
  const avg = data.avg ?? { perDay: 0, perOrderMin: 0 };
  const best = data.best ?? { date: '—', shipped: 0 };
  const worst = data.worst ?? { date: '—', shipped: 0 };
  const totalDays = daily.length;
  const totalPackHours = total.packMin / 60;
  const totalManHours = total.manHours;
  const avgManMinPerOrder =
    total.shipped > 0 ? (total.manHours * 60) / total.shipped : 0;
  const maxOrders = Math.max(...daily.map((d) => d.shipped), 1);

  return (
    <div className="space-y-3 p-1">
      <div>
        <h4 className="text-xs font-bold text-ink-strong mb-2">
          📊 期間サマリー{' '}
          <span className="ml-2 text-2xs text-ink-muted font-normal bg-surface-base px-2 py-0.5 rounded-full border border-surface-border">
            {period.from} 〜 {period.to} ({period.daysCount} 日間)
          </span>
        </h4>
        <div className="grid grid-cols-4 gap-1.5">
          <Kpi
            tone="blue"
            label="総出荷数"
            value={total.shipped.toLocaleString()}
            unit="件"
            onClick={() => setDrillKey('totalShip')}
          />
          <Kpi
            tone="green"
            label="総梱包時間"
            value={totalPackHours.toFixed(1)}
            unit="時間"
            onClick={() => setDrillKey('totalPackTime')}
          />
          <Kpi
            tone="orange"
            label="総出荷完了時間"
            value={(total.packMin / 60).toFixed(1)}
            unit="時間"
            sub="日別最終完了時刻を見る"
            onClick={() => setDrillKey('totalCompleteTime')}
          />
          <Kpi
            tone="violet"
            label="総MH"
            value={totalManHours.toFixed(1)}
            unit="人時"
            onClick={() => setDrillKey('totalMH')}
          />
          <Kpi
            tone="cyan"
            label="1件あたりMH"
            value={avgManMinPerOrder.toFixed(2)}
            unit="分/件"
          />
          <Kpi
            tone="cyan"
            label="日平均出荷"
            value={avg.perDay.toLocaleString()}
            unit="件/日"
          />
          <Kpi
            tone="red"
            label="最大出荷日"
            value={best.shipped.toLocaleString()}
            unit="件"
            sub={best.date}
          />
          <Kpi
            tone="red"
            label="最小出荷日"
            value={worst.shipped.toLocaleString()}
            unit="件"
            sub={worst.date}
          />
          <Kpi
            tone="orange"
            label="強制OK 件数"
            value={total.forceOk.toLocaleString()}
            unit="件"
          />
        </div>
      </div>

      {/* Sprint Z-6: 商品集計（伝票集計と並んで） */}
      <ProductSummarySection
        items={productTop}
        loading={productLoading}
        totalShipped={total.shipped}
      />

      {/* チャート（縦棒シンプル） */}
      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          📈 日別推移
        </h5>
        <div className="bg-surface-base border border-surface-border rounded p-2">
          <div
            className="grid gap-1 items-end"
            style={{
              gridTemplateColumns: `repeat(${Math.max(totalDays, 1)}, minmax(0, 1fr))`,
              height: 120,
            }}
          >
            {daily.map((d) => (
              <div key={d.date} className="flex flex-col items-center gap-0.5">
                <div
                  className={`w-full rounded-t bg-gradient-to-t from-blue-700 to-blue-400 ${d.weekday === '日' || d.weekday === '土' ? 'opacity-60' : ''}`}
                  style={{ height: `${(d.shipped / maxOrders) * 100}%` }}
                  title={`${d.date} ${d.weekday}: ${d.shipped} 件`}
                />
                <div className="text-[8px] text-ink-muted font-mono leading-tight">
                  {d.date.slice(5)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 日別明細 */}
      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          📅 日別明細 ({totalDays} 日)
        </h5>
        <div className="border border-surface-border rounded overflow-auto max-h-[300px]">
          <table className="w-full text-2xs">
            <thead className="bg-surface-base sticky top-0 border-b border-surface-border">
              <tr>
                <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">日付</th>
                <th className="px-1.5 py-1 text-center text-3xs uppercase text-ink-subtle">曜</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">出荷数</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">梱包時間 (h)</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">MH (人時)</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">分/件</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">出勤者</th>
                <th className="px-1.5 py-1 text-right text-3xs uppercase text-ink-subtle">強制OK</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => {
                const isWeekend = d.weekday === '土' || d.weekday === '日';
                const minPerOrder = d.shipped > 0 ? (d.manHours * 60) / d.shipped : 0;
                const clickable = d.shipped > 0;
                return (
                  <tr
                    key={d.date}
                    onClick={
                      clickable
                        ? () => setDayDrill({ date: d.date, weekday: d.weekday })
                        : undefined
                    }
                    className={`border-t border-surface-border ${isWeekend ? 'bg-surface-base/50' : ''} ${
                      clickable ? 'cursor-pointer hover:bg-blue-950/30' : ''
                    }`}
                    title={clickable ? 'クリックで該当日の伝票一覧を開く' : undefined}
                  >
                    <td className="px-1.5 py-1 font-mono">
                      {d.date}
                      {clickable && <span className="ml-1 text-3xs text-blue-300/70">🔍</span>}
                    </td>
                    <td className={`px-1.5 py-1 text-center ${d.weekday === '日' ? 'text-status-error' : d.weekday === '土' ? 'text-status-info' : 'text-ink'}`}>
                      {d.weekday}
                    </td>
                    <td className="px-1.5 py-1 text-right tabular-nums font-bold">{d.shipped.toLocaleString()}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{(d.packMin / 60).toFixed(1)}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{d.manHours.toFixed(1)}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{minPerOrder.toFixed(2)}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{d.staffCount}</td>
                    <td className={`px-1.5 py-1 text-right tabular-nums ${d.forceOk > 0 ? 'text-status-warn' : 'text-ink-muted'}`}>{d.forceOk}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* A-2〜A-5: KPI ドリルダウンモーダル */}
      <KpiDrillModal
        open={drillKey !== null}
        loading={drill.loading}
        errorMsg={drill.errorMsg}
        title={drillTitle(drillKey)}
        subtitle={`${period.from} 〜 ${period.to} 期間中（${period.daysCount} 日間）`}
        cols={drill.cols}
        rows={drill.rows}
        codeFirstCol={drill.codeFirstCol}
        onClose={() => setDrillKey(null)}
        onRowClick={
          drillKey === 'totalShip' || drillKey === 'totalPackTime'
            ? (row) => {
                const pkNo = String(row[0] ?? '');
                if (pkNo) router.push(`/orders?pkNo=${encodeURIComponent(pkNo)}`);
              }
            : undefined
        }
      />

      {/* Task B: 日別ドリルダウン（行クリック → 該当日の伝票一覧） */}
      <KpiDrillModal
        open={dayDrill !== null}
        loading={dayDrillState.loading}
        errorMsg={dayDrillState.errorMsg}
        title={
          dayDrill
            ? `${dayDrill.date}（${dayDrill.weekday}）— 当日の出荷伝票`
            : ''
        }
        subtitle="行クリックで伝票一覧画面に遷移します"
        cols={dayDrillState.cols}
        rows={dayDrillState.rows}
        codeFirstCol={dayDrillState.codeFirstCol}
        emptyHint="この日の伝票はありません"
        onClose={() => setDayDrill(null)}
        onRowClick={(row) => {
          const pkNo = String(row[0] ?? '');
          if (pkNo) router.push(`/orders?pkNo=${encodeURIComponent(pkNo)}`);
        }}
      />
    </div>
  );
}

function drillTitle(key: DrillKey): string {
  switch (key) {
    case 'totalShip':
      return '総出荷数 — 伝票一覧';
    case 'totalPackTime':
      return '総梱包時間 — 所要時間が長い順';
    case 'totalCompleteTime':
      return '総出荷完了時間 — 日別 最終完了時刻';
    case 'totalMH':
      return '総MH — 担当者別 内訳';
    default:
      return '';
  }
}

function ProductSummarySection({
  items,
  loading,
  totalShipped,
}: {
  items: ProductTopRow[];
  loading: boolean;
  totalShipped: number;
}) {
  if (loading) {
    return (
      <div className="text-2xs text-ink-muted">
        📦 商品集計を読み込み中…
      </div>
    );
  }
  // 集計
  const skuCount = items.length;
  const totalQty = items.reduce((s, i) => s + (i.totalQty ?? 0), 0);
  const orderTotal = items.reduce((s, i) => s + (i.orderCount ?? 0), 0);
  const top10 = items.slice(0, 10);
  const aCount = items.filter((i) => i.abc === 'A').length;
  const bCount = items.filter((i) => i.abc === 'B').length;
  const cCount = items.filter((i) => i.abc === 'C').length;
  const topQty = top10[0]?.totalQty ?? 1;
  const topShare =
    totalQty > 0 ? Math.round((top10.reduce((s, i) => s + i.totalQty, 0) / totalQty) * 100) : 0;

  return (
    <div>
      <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
        📦 商品集計（期間内）
      </h5>
      <div className="grid grid-cols-4 gap-1.5 mb-2">
        <Kpi tone="blue" label="出荷 SKU 数" value={skuCount.toLocaleString()} unit="種" />
        <Kpi tone="green" label="総出荷数量" value={totalQty.toLocaleString()} unit="個" />
        <Kpi
          tone="violet"
          label="1 伝票あたり点数"
          value={
            totalShipped > 0 ? (totalQty / totalShipped).toFixed(1) : '—'
          }
          unit="点/件"
        />
        <Kpi
          tone="orange"
          label="トップ 10 シェア"
          value={`${topShare}`}
          unit="%"
          sub={`A:${aCount} / B:${bCount} / C:${cCount}`}
        />
      </div>

      <div className="border border-surface-border rounded overflow-hidden">
        <table className="w-full text-2xs">
          <thead className="bg-surface-base border-b border-surface-border">
            <tr>
              <th className="px-2 py-1 text-center text-3xs uppercase text-ink-subtle">#</th>
              <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">
                商品（コード）
              </th>
              <th className="px-2 py-1 text-right text-3xs uppercase text-ink-subtle">
                出荷数量
              </th>
              <th className="px-2 py-1 text-right text-3xs uppercase text-ink-subtle">
                伝票数
              </th>
              <th className="px-2 py-1 text-center text-3xs uppercase text-ink-subtle">
                ABC
              </th>
              <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">
                シェア
              </th>
            </tr>
          </thead>
          <tbody>
            {top10.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-3 text-center text-ink-muted">
                  期間内に出荷された商品がありません
                </td>
              </tr>
            ) : (
              top10.map((p, i) => {
                const ratio = totalQty > 0 ? (p.totalQty / totalQty) * 100 : 0;
                const barRatio = topQty > 0 ? (p.totalQty / topQty) * 100 : 0;
                const klass: 'A' | 'B' | 'C' = p.abc ?? 'C';
                return (
                  <tr
                    key={p.productCode}
                    className="border-t border-surface-border hover:bg-surface-base"
                  >
                    <td className="px-2 py-1 text-center text-3xs text-ink-muted tabular-nums">
                      {i + 1}
                    </td>
                    <td className="px-2 py-1">
                      <div className="font-bold truncate max-w-[260px]">
                        {p.productName}
                      </div>
                      <div className="text-3xs font-mono text-ink-muted">
                        {p.productCode}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-mono font-bold">
                      {p.totalQty.toLocaleString()}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {p.orderCount.toLocaleString()}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <span
                        className={`inline-block px-1.5 rounded text-3xs font-bold ${
                          klass === 'A'
                            ? 'bg-emerald-900 text-emerald-100'
                            : klass === 'B'
                              ? 'bg-amber-900 text-amber-100'
                              : 'bg-blue-900 text-blue-100'
                        }`}
                      >
                        {klass}
                      </span>
                    </td>
                    <td className="px-2 py-1 min-w-[120px]">
                      <div className="flex items-center gap-1">
                        <div
                          className="h-2 rounded bg-blue-500"
                          style={{ width: `${barRatio}%`, minWidth: 1 }}
                        />
                        <span className="text-3xs tabular-nums text-ink-muted">
                          {ratio.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-3xs text-ink-muted mt-1">
        ※ 期間中の出荷数量上位 10 商品 ／ 全 {skuCount} SKU・{orderTotal.toLocaleString()} 伝票相当
        ／ 完全な ABC ランキングは「商品ランキング」サブタブで確認できます
      </p>
    </div>
  );
}

function Kpi({
  tone,
  label,
  value,
  unit,
  sub,
  onClick,
}: {
  tone: 'blue' | 'green' | 'orange' | 'violet' | 'cyan' | 'red';
  label: string;
  value: string;
  unit: string;
  sub?: string;
  /** クリック可（ドリルダウンモーダル起動）にしたい場合に指定 */
  onClick?: () => void;
}) {
  // Sprint Y-13: 透明度を上げて読みやすく。
  //   背景は不透明な surface-panel ベースに左ボーダー強調、値は ink-strong（白寄せ）。
  const map: Record<typeof tone, { border: string; accent: string; valueColor: string }> = {
    blue: { border: 'border-l-blue-500', accent: 'text-blue-300', valueColor: 'text-blue-100' },
    green: { border: 'border-l-emerald-500', accent: 'text-emerald-300', valueColor: 'text-emerald-100' },
    orange: { border: 'border-l-orange-500', accent: 'text-orange-300', valueColor: 'text-orange-100' },
    violet: { border: 'border-l-violet-500', accent: 'text-violet-300', valueColor: 'text-violet-100' },
    cyan: { border: 'border-l-cyan-500', accent: 'text-cyan-300', valueColor: 'text-cyan-100' },
    red: { border: 'border-l-red-500', accent: 'text-red-300', valueColor: 'text-red-100' },
  };
  const interactive = !!onClick;
  const tones = map[tone];
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`rounded-md border border-surface-border bg-surface-panel border-l-4 ${tones.border} px-2.5 py-2 relative transition-all ${
        interactive
          ? 'cursor-pointer hover:bg-surface-raised hover:border-accent-amber'
          : ''
      }`}
    >
      <div className={`text-2xs ${tones.accent} font-bold flex items-center justify-between gap-1`}>
        <span>{label}</span>
        {interactive && <span className="opacity-60">🔍</span>}
      </div>
      <div className={`text-lg font-bold tabular-nums leading-tight mt-1 ${tones.valueColor}`}>
        {value}
        <span className="text-2xs text-ink-muted ml-1 font-normal">{unit}</span>
      </div>
      {sub && <div className="text-3xs text-ink-muted mt-0.5">{sub}</div>}
      {interactive && !sub && (
        <div className="text-3xs text-ink-muted mt-0.5">クリックで明細</div>
      )}
    </div>
  );
}
