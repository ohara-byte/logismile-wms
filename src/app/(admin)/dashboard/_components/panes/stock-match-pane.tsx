'use client';

/**
 * 📦 検品照合タブ（Sprint Z-3 → Z-4）
 *
 * 当日の在庫引当状況を SKU 単位で一覧化。
 *  - 不足 SKU を先頭にソート
 *  - 各 SKU の必要数 / 引当数（reserved + fulfilled）/ 在庫 / 検品ログを表示
 *  - 通過型は自動割当。出荷照合で残発生時は「引き戻し」で reserved を解放
 *  - 「再引当」ボタンを内蔵（指定日全体）
 *  - フィルタ: 状態（不足 / 割当 / 全て）/ 種別（通過型 / 倉庫 / 受注生産 / 全て）
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface StockMatchRow {
  productCode: string;
  productName: string;
  productJan: string | null;
  productType: string;
  requiredQty: number;
  reservedQty: number;
  fulfilledQty: number;
  allocatedQty: number;
  shortageQty: number;
  orderCount: number;
  stock: {
    qty: number;
    allocatedQty: number;
    availableQty: number;
    inspectedAt: string | null;
    inspectedBy: string | null;
  } | null;
  inspections: Array<{
    qtyDelta: number;
    createdAt: string;
    createdBy: string | null;
  }>;
  status: 'full' | 'partial' | 'short';
}

interface Summary {
  skuCount: number;
  fullCount: number;
  partialCount: number;
  shortCount: number;
}

type StatusKey = 'all' | 'allocated' | 'short';
type TypeKey = 'all' | 'pass_through' | 'warehouse' | 'made_to_order';

interface DiffReport {
  targetDate: string;
  summary: {
    unallocatedOrderCount: number;
    postShipDiffCount: number;
    surplusSkuCount: number;
    stuckReservedCount: number;
  };
  unallocatedOrders: Array<{
    pkNo: string;
    destName: string | null;
    status: string;
    requiredQty: number;
    allocatedQty: number;
    diff: number;
    skus: Array<{
      productCode: string;
      productName: string;
      productType: string;
      requiredQty: number;
      allocatedQty: number;
      diff: number;
    }>;
  }>;
  postShipDiffs: Array<{
    pkNo: string;
    destName: string | null;
    status: string;
    items: Array<{
      productCode: string;
      productName: string;
      qty: number;
      scannedQty: number;
      diff: number;
      forceOk: boolean;
    }>;
  }>;
  surplus: Array<{
    productCode: string;
    productName: string;
    productType: string;
    addedToday: number;
    remainingQty: number;
    availableQty: number;
  }>;
  stuckReserved: Array<{
    pkNo: string;
    productCode: string;
    qty: number;
    status: string;
  }>;
}

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function StockMatchPane() {
  const router = useRouter();
  const params = useSearchParams();
  const [date, setDate] = useState<string>(todayStr());
  const [items, setItems] = useState<StockMatchRow[]>([]);
  const [summary, setSummary] = useState<Summary>({
    skuCount: 0,
    fullCount: 0,
    partialCount: 0,
    shortCount: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusKey, setStatusKey] = useState<StatusKey>('all');
  const [typeKey, setTypeKey] = useState<TypeKey>('all');
  const [diffReport, setDiffReport] = useState<DiffReport | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/stocks/match?date=${date}`);
      const j = await r.json();
      if (!r.ok) {
        setError(j.message ?? `HTTP ${r.status}`);
        return;
      }
      setItems((j.data?.items ?? []) as StockMatchRow[]);
      setSummary((j.data?.summary ?? summary) as Summary);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    void reload();
    const id = setInterval(reload, 15000);
    return () => clearInterval(id);
  }, [reload]);

  async function runRealloc() {
    if (
      !confirm(
        `${date} の出荷指示を再引当します（pending / held のみ対象）。\n業務優先度（運送会社cutoff・冷凍便・出荷日）で再分配されます。`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch(
        `/api/allocation/realloc?date=${date}&includeInspecting=false`,
        { method: 'POST' },
      );
      const j = await r.json();
      if (!r.ok) {
        alert(`再引当に失敗しました: ${j.message ?? r.status}`);
        return;
      }
      const d = j.data ?? {};
      alert(
        `✓ 再引当 完了\n対象 ${d.orderCount} 件 / 引当成功 ${d.allocatedCount} 件\n不足 SKU ${d.shortageSkus} 件 / 製造指示 draft ${d.draftInstructions} 件作成`,
      );
      reload();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runPullback() {
    if (
      !confirm(
        `${date} の通過型 SKU について、出荷照合で残ありの引当を引き戻します。\n（reserved 状態の引当のみ release）`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch(
        `/api/allocation/pullback?date=${date}&productType=pass_through`,
        { method: 'POST' },
      );
      const j = await r.json();
      if (!r.ok) {
        alert(`引き戻しに失敗しました: ${j.message ?? r.status}`);
        return;
      }
      const d = j.data ?? {};
      alert(
        `✓ 引き戻し 完了\n対象 SKU ${d.skuCount} 件 / 引当解放 ${d.releasedCount} 件 / 解放数量 ${d.releasedQty} 個`,
      );
      reload();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadDiffReport() {
    setBusy(true);
    try {
      const r = await fetch(`/api/reports/daily-alloc-diff?date=${date}`);
      const j = await r.json();
      if (!r.ok) {
        alert(j.message ?? `HTTP ${r.status}`);
        return;
      }
      setDiffReport(j.data as DiffReport);
      setDiffOpen(true);
    } finally {
      setBusy(false);
    }
  }

  function jumpToMfg() {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', 'mfg');
    router.replace(`/dashboard?${sp.toString()}`, { scroll: false });
  }

  // 表示用フィルタ
  const filtered = items.filter((row) => {
    // 状態
    if (statusKey === 'short' && row.status !== 'short') return false;
    if (
      statusKey === 'allocated' &&
      row.status !== 'full' &&
      row.status !== 'partial'
    )
      return false;
    // 種別
    if (typeKey !== 'all' && row.productType !== typeKey) return false;
    return true;
  });

  // 種別 別件数（フィルタ前）
  const typeCounts = {
    pass_through: items.filter((i) => i.productType === 'pass_through').length,
    warehouse: items.filter((i) => i.productType === 'warehouse').length,
    made_to_order: items.filter((i) => i.productType === 'made_to_order').length,
  };

  return (
    <div className="p-3">
      {/* ヘッダ */}
      <div className="flex items-center gap-2 mb-2 text-xs flex-wrap">
        <label className="text-ink-subtle">対象日:</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono"
        />
        <button
          type="button"
          onClick={() => setDate(todayStr())}
          className="text-2xs px-2 py-1 rounded bg-blue-900 border border-blue-600 text-blue-100"
        >
          今日
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={runPullback}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded border border-cyan-500 bg-cyan-900 text-cyan-100 hover:bg-cyan-800 font-bold disabled:opacity-50"
          title="通過型 SKU の reserved 引当を解放（出荷照合で残検出時のリセット）"
        >
          ↩ 引き戻し（通過型）
        </button>
        <button
          type="button"
          onClick={runRealloc}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded border border-purple-500 bg-purple-900 text-purple-100 hover:bg-purple-800 font-bold disabled:opacity-50"
        >
          🔄 再引当（業務優先度）
        </button>
        <button
          type="button"
          onClick={loadDiffReport}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded border border-orange-500 bg-orange-900 text-orange-100 hover:bg-orange-800 font-bold disabled:opacity-50"
          title="業務終了時の引当差分・出荷後過不足・在庫だぶつき確認"
        >
          📋 業務終了レポート
        </button>
        <button
          type="button"
          onClick={jumpToMfg}
          className="text-xs px-3 py-1.5 rounded border border-violet-500 bg-violet-900 text-violet-100 hover:bg-violet-800 font-bold"
        >
          🏭 製造指示タブへ
        </button>
        <button
          type="button"
          onClick={reload}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded bg-surface-base border border-surface-border hover:border-accent-amber"
        >
          🔄 更新
        </button>
      </div>

      {/* フィルタバー */}
      <div className="flex items-center gap-2 mb-3 text-xs flex-wrap">
        <span className="text-ink-subtle">状態:</span>
        <FilterPills
          value={statusKey}
          options={[
            {
              value: 'all',
              label: `全て (${summary.skuCount})`,
            },
            {
              value: 'short',
              label: `不足 (${summary.shortCount})`,
              tone: 'red',
            },
            {
              value: 'allocated',
              label: `割当 (${summary.fullCount + summary.partialCount})`,
              tone: 'emerald',
            },
          ]}
          onChange={(v) => setStatusKey(v as StatusKey)}
        />

        <span className="ml-3 text-ink-subtle">種別:</span>
        <FilterPills
          value={typeKey}
          options={[
            { value: 'all', label: '全て' },
            {
              value: 'pass_through',
              label: `通過型 (${typeCounts.pass_through})`,
              tone: 'cyan',
            },
            {
              value: 'warehouse',
              label: `倉庫 (${typeCounts.warehouse})`,
            },
            {
              value: 'made_to_order',
              label: `受注生産 (${typeCounts.made_to_order})`,
              tone: 'amber',
            },
          ]}
          onChange={(v) => setTypeKey(v as TypeKey)}
        />
      </div>

      {error && (
        <div className="mb-2 p-2 text-xs bg-status-error-bg text-status-error border border-status-error rounded">
          {error}
        </div>
      )}

      {/* SKU 一覧 */}
      <div className="border border-surface-border rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface-base border-b border-surface-border">
            <tr>
              <th className="px-2 py-2 text-left text-2xs uppercase text-ink-subtle font-bold">
                商品 / コード
              </th>
              <th className="px-2 py-2 text-center text-2xs uppercase text-ink-subtle font-bold">
                種別
              </th>
              <th className="px-2 py-2 text-right text-2xs uppercase text-ink-subtle font-bold">
                必要
              </th>
              <th className="px-2 py-2 text-right text-2xs uppercase text-ink-subtle font-bold">
                引当
              </th>
              <th className="px-2 py-2 text-right text-2xs uppercase text-ink-subtle font-bold">
                不足
              </th>
              <th className="px-2 py-2 text-right text-2xs uppercase text-ink-subtle font-bold">
                在庫
              </th>
              <th className="px-2 py-2 text-center text-2xs uppercase text-ink-subtle font-bold">
                検品
              </th>
              <th className="px-2 py-2 text-center text-2xs uppercase text-ink-subtle font-bold">
                状態
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="text-center py-8 text-sm text-ink-muted"
                >
                  該当する SKU はありません
                </td>
              </tr>
            )}
            {filtered.map((row) => (
              <tr
                key={row.productCode}
                className={`border-t border-surface-border hover:bg-surface-base ${
                  row.status === 'short'
                    ? 'bg-red-950/20'
                    : row.status === 'partial'
                      ? 'bg-amber-950/15'
                      : ''
                }`}
              >
                <td className="px-2 py-1.5">
                  <div className="font-bold text-ink-strong text-sm leading-tight max-w-[260px] truncate">
                    {row.productName}
                  </div>
                  <div className="text-3xs font-mono text-ink-muted truncate">
                    {row.productCode}
                    {row.productJan && ` / ${row.productJan}`}
                  </div>
                  <div className="text-3xs text-ink-muted">
                    {row.orderCount} 伝票
                  </div>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span
                    className={
                      row.productType === 'pass_through'
                        ? 'text-3xs px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-200 font-bold'
                        : row.productType === 'made_to_order'
                          ? 'text-3xs px-1.5 py-0.5 rounded bg-amber-950 text-accent-amber font-bold'
                          : 'text-3xs px-1.5 py-0.5 rounded bg-surface-base text-ink-subtle font-bold'
                    }
                  >
                    {row.productType === 'pass_through'
                      ? '通過型'
                      : row.productType === 'made_to_order'
                        ? '受注生産'
                        : '倉庫'}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-mono font-bold">
                  {row.requiredQty}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-mono">
                  <span
                    className={
                      row.allocatedQty >= row.requiredQty
                        ? 'text-status-ok font-bold'
                        : row.allocatedQty > 0
                          ? 'text-accent-amber'
                          : 'text-ink-muted'
                    }
                  >
                    {row.allocatedQty}
                  </span>
                  {row.fulfilledQty > 0 && (
                    <div className="text-3xs text-ink-muted">
                      （出荷済 {row.fulfilledQty}）
                    </div>
                  )}
                </td>
                <td
                  className={`px-2 py-1.5 text-right tabular-nums font-mono ${
                    row.shortageQty > 0
                      ? 'text-status-error font-bold'
                      : 'text-ink-muted'
                  }`}
                >
                  {row.shortageQty > 0 ? row.shortageQty : '—'}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-mono">
                  {row.stock ? (
                    <>
                      <div>{row.stock.qty}</div>
                      <div className="text-3xs text-ink-muted">
                        利用可 {row.stock.availableQty}
                      </div>
                    </>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center text-2xs">
                  {row.inspections.length > 0 ? (
                    <div title={row.inspections.map((i) => `${i.createdBy ?? '?'} +${i.qtyDelta}`).join('\n')}>
                      <span className="text-status-ok font-bold">
                        ✓ {row.inspections.length}回
                      </span>
                      <div className="text-3xs text-ink-muted">
                        +
                        {row.inspections.reduce(
                          (s, i) => s + i.qtyDelta,
                          0,
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <StatusPill status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-3xs text-ink-muted">
        ※ 15 秒ごと自動更新。 ハンディで在庫検品を実施すると即座にここへ反映されます。
        通過型 SKU は出来高反映後に自動再引当。出荷照合で残検出時は「↩ 引き戻し」で reserved を解放できます。
        不足のある SKU は「🏭 製造指示」タブで draft が自動生成されています。受注生産品は伝票引当せず、検品開始（FIFO）でプールから引当します。
      </p>

      {diffOpen && diffReport && (
        <DiffReportModal
          report={diffReport}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </div>
  );
}

function DiffReportModal({
  report,
  onClose,
}: {
  report: DiffReport;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-panel border-2 border-accent-amber rounded-[10px] shadow-modal max-w-4xl w-full max-h-[90vh] overflow-auto">
        <div className="px-4 py-3 border-b border-surface-border flex justify-between items-center sticky top-0 bg-surface-panel">
          <h3 className="text-sm font-bold text-accent-amber">
            📋 業務終了レポート（{report.targetDate}）
          </h3>
          <button
            onClick={onClose}
            className="text-ink-subtle hover:text-ink-strong text-xl"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* サマリ */}
          <div className="grid grid-cols-4 gap-2">
            <SumCell
              label="伝票未引当"
              value={report.summary.unallocatedOrderCount}
              tone="red"
            />
            <SumCell
              label="出荷後過不足"
              value={report.summary.postShipDiffCount}
              tone="amber"
            />
            <SumCell
              label="在庫だぶつき(通過型)"
              value={report.summary.surplusSkuCount}
              tone="cyan"
            />
            <SumCell
              label="reserved 残留"
              value={report.summary.stuckReservedCount}
              tone="muted"
            />
          </div>

          {/* (1) 伝票未引当 */}
          <ReportSection
            title={`① 伝票未引当（${report.unallocatedOrders.length} 件）`}
            description="出荷予定があるのに引当不足の伝票"
          >
            {report.unallocatedOrders.length === 0 ? (
              <Empty />
            ) : (
              <table className="w-full text-2xs">
                <thead className="bg-surface-base">
                  <tr>
                    <th className="px-2 py-1 text-left">伝票№</th>
                    <th className="px-2 py-1 text-left">顧客</th>
                    <th className="px-2 py-1 text-center">状態</th>
                    <th className="px-2 py-1 text-right">必要</th>
                    <th className="px-2 py-1 text-right">引当</th>
                    <th className="px-2 py-1 text-right">不足</th>
                    <th className="px-2 py-1 text-left">不足 SKU</th>
                  </tr>
                </thead>
                <tbody>
                  {report.unallocatedOrders.map((o) => (
                    <tr key={o.pkNo} className="border-t border-surface-border">
                      <td className="px-2 py-1 font-mono text-accent-amber">
                        {o.pkNo}
                      </td>
                      <td className="px-2 py-1 truncate max-w-[140px]">
                        {o.destName ?? '—'}
                      </td>
                      <td className="px-2 py-1 text-center">{o.status}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {o.requiredQty}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {o.allocatedQty}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-status-error font-bold">
                        {o.diff}
                      </td>
                      <td className="px-2 py-1 text-3xs text-ink-muted">
                        {o.skus
                          .map((s) => `${s.productName}(${s.productType}) -${s.diff}`)
                          .join(' / ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ReportSection>

          {/* (2) 出荷後過不足 */}
          <ReportSection
            title={`② 出荷後過不足（${report.postShipDiffs.length} 件）`}
            description="検品済みなのに scannedQty != qty の品目（強制OK 含む）"
          >
            {report.postShipDiffs.length === 0 ? (
              <Empty />
            ) : (
              <div className="space-y-2">
                {report.postShipDiffs.map((o) => (
                  <div
                    key={o.pkNo}
                    className="border border-surface-border rounded p-2"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-2xs text-accent-amber">
                        {o.pkNo}
                      </span>
                      <span className="text-2xs">{o.destName ?? '—'}</span>
                      <span className="text-3xs text-ink-muted">
                        ({o.status})
                      </span>
                    </div>
                    <ul className="text-2xs space-y-0.5 ml-4">
                      {o.items.map((it, i) => (
                        <li
                          key={i}
                          className={
                            it.diff > 0
                              ? 'text-status-error'
                              : it.diff < 0
                                ? 'text-accent-amber'
                                : 'text-ink-muted'
                          }
                        >
                          {it.productName}：必要 {it.qty} / 検品 {it.scannedQty}
                          （{it.diff > 0 ? '+' : ''}
                          {it.diff}）
                          {it.forceOk && (
                            <span className="ml-1 text-3xs">[強制OK]</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </ReportSection>

          {/* (3) 在庫だぶつき */}
          <ReportSection
            title={`③ 在庫だぶつき（${report.surplus.length} SKU）`}
            description="通過型で当日加算したが消費されずに残っている在庫"
          >
            {report.surplus.length === 0 ? (
              <Empty />
            ) : (
              <table className="w-full text-2xs">
                <thead className="bg-surface-base">
                  <tr>
                    <th className="px-2 py-1 text-left">商品</th>
                    <th className="px-2 py-1 text-right">当日加算</th>
                    <th className="px-2 py-1 text-right">残在庫</th>
                    <th className="px-2 py-1 text-right">利用可</th>
                  </tr>
                </thead>
                <tbody>
                  {report.surplus.map((s) => (
                    <tr
                      key={s.productCode}
                      className="border-t border-surface-border"
                    >
                      <td className="px-2 py-1">
                        <div>{s.productName}</div>
                        <div className="text-3xs text-ink-muted font-mono">
                          {s.productCode}
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        +{s.addedToday}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {s.remainingQty}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-cyan-300 font-bold">
                        {s.availableQty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ReportSection>

          {/* (4) reserved 残留 */}
          <ReportSection
            title={`④ reserved 残留（${report.stuckReserved.length} 件）`}
            description="packed/shipped なのに Allocation が reserved のまま（fulfilled 化漏れ）"
          >
            {report.stuckReserved.length === 0 ? (
              <Empty />
            ) : (
              <table className="w-full text-2xs">
                <thead className="bg-surface-base">
                  <tr>
                    <th className="px-2 py-1 text-left">伝票№</th>
                    <th className="px-2 py-1 text-left">商品コード</th>
                    <th className="px-2 py-1 text-right">数量</th>
                    <th className="px-2 py-1 text-center">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {report.stuckReserved.map((s, i) => (
                    <tr
                      key={i}
                      className="border-t border-surface-border"
                    >
                      <td className="px-2 py-1 font-mono text-accent-amber">
                        {s.pkNo}
                      </td>
                      <td className="px-2 py-1 font-mono">{s.productCode}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {s.qty}
                      </td>
                      <td className="px-2 py-1 text-center text-status-warn">
                        {s.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ReportSection>
        </div>
      </div>
    </div>
  );
}

function SumCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'red' | 'amber' | 'cyan' | 'muted';
}) {
  const map: Record<typeof tone, string> = {
    red: 'border-l-red-500 text-red-200',
    amber: 'border-l-amber-500 text-amber-200',
    cyan: 'border-l-cyan-500 text-cyan-200',
    muted: 'border-l-surface-border text-ink-muted',
  };
  return (
    <div
      className={`rounded-md border border-surface-border bg-surface-base border-l-4 ${map[tone].split(' ')[0]} px-2.5 py-1.5 text-center`}
    >
      <div className={`text-2xs font-bold ${map[tone].split(' ')[1]}`}>
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums leading-tight mt-0.5">
        {value}
        <small className="text-2xs font-normal ml-1 text-ink-muted">件</small>
      </div>
    </div>
  );
}

function ReportSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-surface-border rounded">
      <div className="px-3 py-2 bg-surface-base border-b border-surface-border">
        <div className="text-sm font-bold">{title}</div>
        <div className="text-3xs text-ink-muted">{description}</div>
      </div>
      <div className="p-2">{children}</div>
    </div>
  );
}

function Empty() {
  return (
    <div className="text-center py-3 text-2xs text-ink-muted">
      該当データはありません
    </div>
  );
}

function FilterPills({
  value,
  options,
  onChange,
}: {
  value: string;
  options: {
    value: string;
    label: string;
    tone?: 'red' | 'emerald' | 'cyan' | 'amber';
  }[];
  onChange: (v: string) => void;
}) {
  const toneClass: Record<
    'red' | 'emerald' | 'cyan' | 'amber',
    string
  > = {
    red: 'text-red-200',
    emerald: 'text-emerald-200',
    cyan: 'text-cyan-200',
    amber: 'text-amber-200',
  };
  return (
    <div className="inline-flex border border-surface-border rounded overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-2xs font-bold ${
            value === opt.value
              ? 'bg-accent-amber text-surface-base'
              : `bg-surface-base hover:bg-surface-panel ${
                  opt.tone ? toneClass[opt.tone] : 'text-ink-subtle'
                }`
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: 'full' | 'partial' | 'short' }) {
  const map: Record<typeof status, { cls: string; label: string }> = {
    full: { cls: 'bg-emerald-900 text-emerald-100 border-emerald-600', label: '✓ 完了' },
    partial: { cls: 'bg-amber-900 text-amber-100 border-amber-600', label: '⚠ 部分' },
    short: { cls: 'bg-red-900 text-red-100 border-red-600', label: '✗ 不足' },
  };
  const m = map[status];
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-2xs font-bold border ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
