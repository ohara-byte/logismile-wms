'use client';

/**
 * 📋 未検品照合タブ
 *
 * モック準拠（管理用PCモック_v0.22.html L4614-4727）
 *
 * 構成:
 *   1. ツールバー: 基準日 / 納品書バーコード照合 input / デモスキャン /
 *      全目視☑ / 全クリア / CSV出力
 *   2. 5 統計カード: 総件数 / 検品済 / 未検品 / 照合済 / 繰越候補
 *   3. アクションバー（matched > 0 で表示）: 翌日繰越実行
 *   4. 一覧テーブル: 📷バーコード / 👁目視 / 伝票No / 納品書No / 顧客 /
 *      配送便 / テーブル / 明細点数 / 状態 / 操作
 *   5. mtoa-modal: 6 アクション（強制完了 / 翌日繰越 / キャンセル /
 *      伝票詳細 / ピッキング票再発行 / メモ追記）+ 理由 textarea
 */

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useBadges } from '@/components/admin/badge-context';
import { useOrderDetailModal } from '@/components/admin/order-detail-context';

interface MatchRow {
  pkNo: string;
  invoiceNo: string | null;
  destName: string | null;
  destAddr: string | null;
  carrier: { code: string; name: string; short: string | null; cool: boolean } | null;
  tableLabel: string | null;
  staffName: string | null;
  itemCount: number;
  status: string;
  inspected: boolean;
  /** キャンセル（LogiSmile取消＝論理削除）。includeCancelled=1 のとき true が混ざる。 */
  cancelled?: boolean;
  matchStatus: 'none' | 'barcode' | 'visual';
  matchedAt: string | null;
  matchedBy: string | null;
  // Sprint Z-5: 引当差分情報
  requiredQty: number;
  allocatedQty: number;
  allocDiff: number;
  allocStatus: 'full' | 'partial' | 'none';
}

interface Stats {
  total: number;
  done: number;
  pending: number;
  matched: number;
  carryCandidate: number;
  // Sprint Z-5
  allocFull: number;
  allocPartial: number;
  allocNone: number;
  allocDiffCount: number;
  cancelledCount?: number;
}

type AllocFilterKey = 'all' | 'diff' | 'full' | 'partial' | 'none';

// Sprint Z-10: 検品状態フィルタ（未検品の抽出用）
type InspectFilterKey = 'all' | 'done' | 'pending';

type ActionKind = 'complete' | 'carry' | 'cancel' | 'reprint' | 'note';

const ACTION_DEFS: { kind: ActionKind; icon: string; title: string; desc: string; variant: 'success' | 'warn' | 'danger' | 'primary' }[] = [
  { kind: 'complete', icon: '✅', title: '強制完了', desc: '検品せず完了扱い（実績送信対象）', variant: 'success' },
  { kind: 'carry', icon: '🟠', title: '翌日繰越', desc: '明日に持ち越し（伝票No末尾→CR）', variant: 'warn' },
  { kind: 'cancel', icon: '❌', title: 'キャンセル', desc: '出荷取消（基幹へ取消通知）', variant: 'danger' },
  { kind: 'reprint', icon: '🖨', title: 'ピッキング票再発行', desc: '紛失/破損時の再印刷', variant: 'primary' },
  { kind: 'note', icon: '📝', title: 'メモ追記', desc: '本部への申送り事項を記録', variant: 'primary' },
];

export function MatchPane() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayIso);
  const [data, setData] = useState<{ stats: Stats; items: MatchRow[] } | null>(null);
  const [scanInput, setScanInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanFlash, setScanFlash] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<MatchRow | null>(null);
  // 一括処理ダイアログ — 'carry' / 'complete' / 'cancel' のいずれか起動中の種別
  const [bulkDialog, setBulkDialog] = useState<null | 'carry' | 'complete' | 'cancel'>(
    null,
  );
  const [allocFilter, setAllocFilter] = useState<AllocFilterKey>('all');
  // 検品状態フィルタ（未検品の抽出用）。既定は全て。カードのクリックでも切替。
  const [inspectFilter, setInspectFilter] = useState<InspectFilterKey>('all');
  // キャンセル(取消)除外。既定ON＝取消伝票を一覧から外す。OFFで取消も表示（印付き）。
  const [excludeCancelled, setExcludeCancelled] = useState(true);

  const { refresh: refreshBadges } = useBadges();
  const { open: openOrderDetail } = useOrderDetailModal();

  const reload = useCallback(async () => {
    try {
      const qs = `date=${date}${excludeCancelled ? '' : '&includeCancelled=1'}`;
      const r = await fetch(`/api/orders/match?${qs}`);
      const j = await r.json();
      if (!r.ok) {
        setError(j?.message ?? `HTTP ${r.status}`);
        return;
      }
      setData(j.data);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [date, excludeCancelled]);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [reload]);

  async function setMatchStatus(pkNo: string, status: 'none' | 'barcode' | 'visual') {
    setBusy(true);
    // 楽観更新
    setData((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((it) =>
        it.pkNo === pkNo
          ? { ...it, matchStatus: status, matchedAt: status === 'none' ? null : new Date().toISOString() }
          : it,
      );
      return { ...prev, items, stats: recomputeStats(items) };
    });
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(pkNo)}/match`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${r.status}`);
      }
      refreshBadges();
    } catch (e) {
      setError(String(e));
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleScan(value: string) {
    const v = value.trim();
    if (!v || !data) return;
    // 部分一致 or 完全一致で検索
    const target =
      data.items.find((it) => it.invoiceNo === v) ??
      data.items.find((it) => it.invoiceNo && it.invoiceNo.includes(v));
    if (!target) {
      setScanFlash(`❌ 該当なし: ${v}`);
      setTimeout(() => setScanFlash(null), 2500);
      return;
    }
    if (target.matchStatus === 'barcode') {
      setScanFlash(`✓ 既に照合済: ${target.pkNo}`);
    } else {
      await setMatchStatus(target.pkNo, 'barcode');
      setScanFlash(`✅ 照合: ${target.pkNo}`);
    }
    setTimeout(() => setScanFlash(null), 2500);
  }

  function demoScan() {
    if (!data) return;
    // 未照合の最初の伝票のバーコードでテスト
    const candidate = data.items.find((it) => !it.inspected && it.matchStatus === 'none' && it.invoiceNo);
    if (!candidate) {
      setScanFlash('（未照合かつ納品書№付きの伝票がありません）');
      setTimeout(() => setScanFlash(null), 2500);
      return;
    }
    setScanInput(candidate.invoiceNo ?? '');
    handleScan(candidate.invoiceNo ?? '');
  }

  async function checkAllVisual(checked: boolean) {
    if (!data) return;
    const targets = data.items.filter((it) => !it.inspected && it.matchStatus !== 'barcode');
    if (targets.length === 0) return;
    if (!confirm(`${targets.length} 件の未検品伝票を ${checked ? '目視☑' : 'クリア'} します。よろしいですか？`)) return;
    setBusy(true);
    try {
      await Promise.all(
        targets.map((t) =>
          fetch(`/api/orders/${encodeURIComponent(t.pkNo)}/match`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: checked ? 'visual' : 'none' }),
          }),
        ),
      );
      refreshBadges();
      reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function executeBulk(action: 'carry' | 'complete' | 'cancel', reason: string) {
    setBusy(true);
    try {
      const r = await fetch('/api/orders/match/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, action, reason }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j?.message ?? `HTTP ${r.status}`);
        return;
      }
      const verb =
        action === 'carry' ? '翌日繰越' : action === 'complete' ? '強制完了' : 'キャンセル';
      alert(`✅ ${j.data.affected} 件を一括${verb}しました`);
      refreshBadges();
      reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setBulkDialog(null);
    }
  }

  const matchedCount = data?.stats.carryCandidate ?? 0;

  return (
    <div className="p-3">
      {/* ツールバー */}
      <div className="bg-surface-base border border-surface-border rounded p-2 mb-2 flex flex-wrap gap-1.5 items-center text-2xs">
        <span className="text-ink-subtle">基準日:</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-surface-panel border border-surface-border rounded px-1.5 py-0.5 text-2xs text-ink"
        />
        <span className="text-ink-subtle ml-2">📷 納品書照合:</span>
        <input
          type="text"
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleScan(scanInput);
              setScanInput('');
            }
          }}
          placeholder="納品書№をスキャン or 入力 + Enter"
          className="flex-1 min-w-[200px] bg-surface-panel border border-surface-border rounded px-2 py-0.5 text-2xs text-ink font-mono"
          autoComplete="off"
        />
        <button
          onClick={demoScan}
          className="px-2 py-0.5 rounded bg-brand-primary text-white text-[10px] font-bold hover:bg-blue-600"
        >
          📷 デモ
        </button>
        <div className="w-full flex flex-wrap gap-1.5 mt-1">
          <button
            onClick={() => checkAllVisual(true)}
            disabled={busy}
            className="px-2 py-0.5 rounded border border-surface-border bg-surface-panel text-ink-subtle hover:text-ink hover:border-accent-amber text-[10px]"
          >
            全て目視☑
          </button>
          <button
            onClick={() => checkAllVisual(false)}
            disabled={busy}
            className="px-2 py-0.5 rounded border border-surface-border bg-surface-panel text-ink-subtle hover:text-ink text-[10px]"
          >
            全クリア
          </button>
          <label
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-surface-border bg-surface-panel text-[10px] text-ink-subtle cursor-pointer"
            title="キャンセル（LogiSmile取消＝論理削除）の伝票を一覧から除外します。外すと取消伝票も「取消」印付きで表示します。"
          >
            <input
              type="checkbox"
              checked={excludeCancelled}
              onChange={(e) => setExcludeCancelled(e.target.checked)}
              className="cursor-pointer"
            />
            キャンセル除外
            {!excludeCancelled && data?.stats.cancelledCount
              ? `（${data.stats.cancelledCount}）`
              : ''}
          </label>
          <div className="flex-1" />
          <button
            onClick={() => alert('CSV 出力は将来ブロックで実装予定です')}
            className="px-2 py-0.5 rounded border border-status-warn/40 bg-amber-950/30 text-amber-200 text-[10px] hover:bg-amber-900"
          >
            ⬇ CSV
          </button>
        </div>
        {scanFlash && (
          <div className="w-full text-[10px] text-accent-amber mt-1">{scanFlash}</div>
        )}
      </div>

      {error && (
        <div className="mb-2 p-2 text-2xs bg-status-error-bg text-status-error border border-status-error rounded">
          {error}
        </div>
      )}

      {/* 統計カード */}
      {data && (
        <div className="grid grid-cols-5 gap-1 mb-2">
          <StatBox
            label="総件数"
            value={data.stats.total}
            tone="blue"
            onClick={() => setInspectFilter('all')}
            active={inspectFilter === 'all'}
          />
          <StatBox
            label="検品済"
            value={data.stats.done}
            tone="green"
            onClick={() => setInspectFilter('done')}
            active={inspectFilter === 'done'}
          />
          <StatBox
            label="未検品"
            value={data.stats.pending}
            tone="orange"
            onClick={() => setInspectFilter('pending')}
            active={inspectFilter === 'pending'}
          />
          <StatBox label="照合済" value={data.stats.matched} tone="violet" />
          <StatBox label="繰越候補" value={data.stats.carryCandidate} tone="red" />
        </div>
      )}

      {/* Sprint Z-10: 検品状態フィルタ（未検品を抽出できるように）。カードのクリックとも連動。 */}
      {data && (
        <div className="flex items-center gap-2 mb-2 text-2xs flex-wrap">
          <span className="text-ink-subtle">検品状態:</span>
          <FilterPills
            value={inspectFilter}
            onChange={(v) => setInspectFilter(v as InspectFilterKey)}
            options={[
              { value: 'all', label: `全て (${data.stats.total})` },
              { value: 'done', label: `検品済 (${data.stats.done})`, tone: 'emerald' },
              { value: 'pending', label: `未検品 (${data.stats.pending})`, tone: 'amber' },
            ]}
          />
          <span className="ml-2 text-3xs text-ink-muted">
            ※ 未検品を選ぶと、その日の未検品伝票だけを抽出します（上の件数カードのクリックでも切替可）
          </span>
        </div>
      )}

      {/* Sprint Z-5: 引当差分フィルタ */}
      {data && (
        <div className="flex items-center gap-2 mb-2 text-2xs flex-wrap">
          <span className="text-ink-subtle">引当差分:</span>
          <FilterPills
            value={allocFilter}
            onChange={(v) => setAllocFilter(v as AllocFilterKey)}
            options={[
              { value: 'all', label: `全て (${data.stats.total})` },
              {
                value: 'diff',
                label: `差分あり (${data.stats.allocDiffCount})`,
                tone: 'red',
              },
              {
                value: 'full',
                label: `引当完了 (${data.stats.allocFull})`,
                tone: 'emerald',
              },
              {
                value: 'partial',
                label: `部分引当 (${data.stats.allocPartial})`,
                tone: 'amber',
              },
              {
                value: 'none',
                label: `未引当 (${data.stats.allocNone})`,
                tone: 'red',
              },
            ]}
          />
          <span className="ml-2 text-3xs text-ink-muted">
            ※ 承認前の状態で引当不足を確認するためのフィルタです
          </span>
        </div>
      )}

      {/* 一括処理アクションバー — 強制完了 / 翌日繰越 / キャンセル の 3 択 */}
      {matchedCount > 0 && (
        <div className="mb-2 px-2.5 py-1.5 rounded border border-status-warn/50 bg-amber-950/30 flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[10px] text-amber-100 min-w-0">
            ✓ <b>{matchedCount}</b> 件の未検品伝票が照合済みです。下記のいずれかの一括処理を選択してください。
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setBulkDialog('complete')}
              disabled={busy}
              className="px-2.5 py-1 rounded bg-emerald-700 border border-emerald-500 text-white text-[10px] font-bold hover:bg-emerald-600 whitespace-nowrap disabled:opacity-50"
              title="検品せず完了扱いにする（実績送信対象）"
            >
              ✅ 強制完了を実行
            </button>
            <button
              onClick={() => setBulkDialog('carry')}
              disabled={busy}
              className="px-2.5 py-1 rounded bg-orange-700 border border-orange-500 text-white text-[10px] font-bold hover:bg-orange-600 whitespace-nowrap disabled:opacity-50"
              title="明日の出荷指示として繰越す"
            >
              🟠 翌日繰越を実行
            </button>
            <button
              onClick={() => setBulkDialog('cancel')}
              disabled={busy}
              className="px-2.5 py-1 rounded bg-red-700 border border-red-500 text-white text-[10px] font-bold hover:bg-red-600 whitespace-nowrap disabled:opacity-50"
              title="出荷取消（基幹へ取消通知）"
            >
              ❌ キャンセルを実行
            </button>
          </div>
        </div>
      )}

      {/* 一覧テーブル */}
      {data && (() => {
        const filteredItems = data.items.filter((it) => {
          // キャンセル除外（既定ON）。API側でも除外するが、トグル直後の整合のため二重で守る。
          if (excludeCancelled && it.cancelled) return false;
          // 引当差分フィルタ
          const allocOk =
            allocFilter === 'all'
              ? true
              : allocFilter === 'diff'
                ? it.allocStatus !== 'full'
                : it.allocStatus === allocFilter;
          if (!allocOk) return false;
          // 検品状態フィルタ（未検品の抽出）
          if (inspectFilter === 'done') return it.inspected;
          if (inspectFilter === 'pending') return !it.inspected;
          return true;
        });
        return (
          <div className="border border-surface-border rounded">
            <table className="w-full text-[10px]">
              <thead className="bg-surface-base border-b border-surface-border sticky top-0 z-10">
                <tr>
                  <th className="px-1.5 py-1 text-center w-[80px] uppercase text-ink-subtle font-bold">📷</th>
                  <th className="px-1.5 py-1 text-center w-[44px] uppercase text-ink-subtle font-bold">👁</th>
                  <th className="px-1.5 py-1 text-left uppercase text-ink-subtle font-bold">伝票No</th>
                  <th className="px-1.5 py-1 text-left uppercase text-ink-subtle font-bold">納品書</th>
                  <th className="px-1.5 py-1 text-left uppercase text-ink-subtle font-bold">顧客</th>
                  <th className="px-1.5 py-1 text-left uppercase text-ink-subtle font-bold">便</th>
                  <th className="px-1.5 py-1 text-center uppercase text-ink-subtle font-bold">担当</th>
                  <th className="px-1.5 py-1 text-right uppercase text-ink-subtle font-bold">点</th>
                  <th className="px-1.5 py-1 text-right uppercase text-ink-subtle font-bold">引当差</th>
                  <th className="px-1.5 py-1 text-center uppercase text-ink-subtle font-bold">状態</th>
                  <th className="px-1.5 py-1 text-center uppercase text-ink-subtle font-bold">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={11}
                      className="text-center py-6 text-ink-muted text-2xs"
                    >
                      該当する伝票がありません
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((row) => (
                    <MatchTr
                      key={row.pkNo}
                      row={row}
                      onBarcode={() =>
                        setMatchStatus(
                          row.pkNo,
                          row.matchStatus === 'barcode' ? 'none' : 'barcode',
                        )
                      }
                      onVisual={() =>
                        setMatchStatus(
                          row.pkNo,
                          row.matchStatus === 'visual' ? 'none' : 'visual',
                        )
                      }
                      onAction={() => setActionTarget(row)}
                      onOpenDetail={() => openOrderDetail(row.pkNo)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* 一括処理 確認ダイアログ — action 別に文言と色を切替 */}
      <ConfirmDialog
        open={bulkDialog !== null}
        title={
          bulkDialog === 'complete'
            ? '強制完了を一括実行しますか？'
            : bulkDialog === 'carry'
              ? '翌日繰越を一括実行しますか？'
              : 'キャンセル（出荷取消）を一括実行しますか？'
        }
        body={
          <div className="space-y-1 text-2xs">
            <div>
              照合済の<b className="text-accent-amber">{matchedCount}件</b>
              の未検品伝票に対し
              {bulkDialog === 'complete' && (
                <>
                  <b className="text-status-ok">「強制完了」</b>を一括実行します。
                  ステータスが <b>packed</b> に更新され、実績送信対象となります。
                </>
              )}
              {bulkDialog === 'carry' && (
                <>
                  <b className="text-status-warn">「翌日繰越」</b>を一括実行します。
                  shipDate が 明日（{nextDate(date)}）に変更されます。
                </>
              )}
              {bulkDialog === 'cancel' && (
                <>
                  <b className="text-status-error">「キャンセル」</b>を一括実行します。
                  伝票が論理削除され、基幹へ取消通知が送信されます。
                </>
              )}
            </div>
            <div className="text-status-warn">
              ⚠ この操作は伝票単位のロールバック機能がありません。実行前に必ずご確認ください。
            </div>
          </div>
        }
        promptLabel={
          bulkDialog === 'complete'
            ? '強制完了の理由（必須）'
            : bulkDialog === 'carry'
              ? '繰越理由（必須）'
              : 'キャンセル理由（必須）'
        }
        promptPlaceholder={
          bulkDialog === 'complete'
            ? '例: 検品時間切れ、現場確認済のため一括完了'
            : bulkDialog === 'carry'
              ? '例: 繁忙期で時間切れのため翌日繰越'
              : '例: 配送会社の集荷時刻超過、お客様連絡済'
        }
        confirmLabel={
          bulkDialog === 'complete'
            ? '✅ 一括強制完了'
            : bulkDialog === 'carry'
              ? '🟠 一括繰越実行'
              : '❌ 一括キャンセル'
        }
        variant={
          bulkDialog === 'complete'
            ? 'success'
            : bulkDialog === 'carry'
              ? 'warn'
              : 'danger'
        }
        onConfirm={(reason) => {
          if (bulkDialog) executeBulk(bulkDialog, reason);
        }}
        onCancel={() => setBulkDialog(null)}
      />

      {/* mtoa-modal */}
      {actionTarget && (
        <MatchActionModal
          row={actionTarget}
          onClose={() => setActionTarget(null)}
          onComplete={() => {
            refreshBadges();
            reload();
            setActionTarget(null);
          }}
          onOpenDetail={(pkNo) => {
            setActionTarget(null);
            openOrderDetail(pkNo);
          }}
        />
      )}
    </div>
  );
}

function recomputeStats(items: MatchRow[]): Stats {
  // 統計はキャンセル(取消)を除いた実出荷対象で数える（API と同一基準）。
  const active = items.filter((i) => !i.cancelled);
  const total = active.length;
  const done = active.filter((i) => i.inspected).length;
  const pending = total - done;
  const matched = active.filter((i) => i.matchStatus !== 'none').length;
  const carryCandidate = active.filter((i) => !i.inspected && i.matchStatus !== 'none').length;
  const allocFull = active.filter((i) => i.allocStatus === 'full').length;
  const allocPartial = active.filter((i) => i.allocStatus === 'partial').length;
  const allocNone = active.filter((i) => i.allocStatus === 'none').length;
  const allocDiffCount = active.filter((i) => i.allocStatus !== 'full').length;
  return {
    total,
    done,
    pending,
    matched,
    carryCandidate,
    allocFull,
    allocPartial,
    allocNone,
    allocDiffCount,
    cancelledCount: items.length - active.length,
  };
}

function nextDate(iso: string): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ──────────────────────────────────────────────
// テーブル行
// ──────────────────────────────────────────────

function MatchTr({
  row,
  onBarcode,
  onVisual,
  onAction,
  onOpenDetail,
}: {
  row: MatchRow;
  onBarcode: () => void;
  onVisual: () => void;
  onAction: () => void;
  /** 伝票NO クリックで伝票詳細モーダルを開く */
  onOpenDetail: () => void;
}) {
  const rowCls = row.cancelled
    ? 'bg-red-950/20 opacity-60'
    : row.inspected
      ? 'bg-emerald-950/20'
      : row.matchStatus !== 'none'
        ? 'bg-amber-950/20'
        : '';
  return (
    <tr className={`border-t border-surface-border ${rowCls}`}>
      <td className="px-1.5 py-1 text-center">
        <button
          onClick={onBarcode}
          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
            row.matchStatus === 'barcode'
              ? 'bg-emerald-700 border-emerald-500 text-white'
              : 'bg-surface-panel border-surface-border text-ink-muted hover:border-accent-amber'
          }`}
          title="バーコード照合"
        >
          {row.matchStatus === 'barcode' ? '✓ 照合済' : '○'}
        </button>
      </td>
      <td className="px-1.5 py-1 text-center">
        <input
          type="checkbox"
          checked={row.matchStatus === 'visual'}
          onChange={onVisual}
          className="cursor-pointer"
        />
      </td>
      <td className="px-1.5 py-1 font-mono tabular-nums">
        <button
          type="button"
          onClick={onOpenDetail}
          className="text-accent-amber hover:underline focus:outline-none focus:ring-1 focus:ring-accent-amber rounded"
          title="クリックで伝票の詳細を表示"
        >
          {row.pkNo}
        </button>
      </td>
      <td className="px-1.5 py-1 font-mono text-ink-subtle">{row.invoiceNo ?? '—'}</td>
      <td className="px-1.5 py-1 truncate max-w-[140px]" title={row.destName ?? ''}>
        {row.cancelled && (
          <span className="mr-1 px-1 rounded bg-red-700 text-white text-[9px] font-bold align-middle">取消</span>
        )}
        {row.destName ?? '—'}
      </td>
      <td className="px-1.5 py-1 text-ink-subtle">
        {row.carrier?.short ?? row.carrier?.name ?? '—'}
        {row.carrier?.cool && <span className="text-status-info ml-0.5">❄</span>}
      </td>
      <td className="px-1.5 py-1 text-center text-ink-subtle truncate max-w-[80px]">
        {row.staffName ?? row.tableLabel ?? '—'}
      </td>
      <td className="px-1.5 py-1 text-right tabular-nums">{row.itemCount}</td>
      <td className="px-1.5 py-1 text-right tabular-nums">
        <AllocCell row={row} />
      </td>
      <td className="px-1.5 py-1 text-center">
        <StatusPill status={row.status} inspected={row.inspected} />
      </td>
      <td className="px-1.5 py-1 text-center">
        <button
          onClick={onAction}
          disabled={row.inspected}
          className="px-2 py-0.5 rounded border border-surface-border bg-surface-base text-ink-subtle hover:text-ink hover:border-accent-amber text-[10px] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ⚙ 処理
        </button>
      </td>
    </tr>
  );
}

function StatusPill({ status, inspected }: { status: string; inspected: boolean }) {
  if (inspected) return <span className="text-status-ok text-[10px]">✅ 完了</span>;
  switch (status) {
    case 'pending':
      return <span className="text-ink-muted text-[10px]">○ 未着手</span>;
    case 'inspecting':
      return <span className="text-status-info text-[10px]">🟦 検品中</span>;
    case 'held':
      return <span className="text-status-warn text-[10px]">⏸ 保留</span>;
    default:
      return <span className="text-ink-muted text-[10px]">{status}</span>;
  }
}

function StatBox({
  label,
  value,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: number;
  tone: 'blue' | 'green' | 'orange' | 'violet' | 'red';
  onClick?: () => void;
  active?: boolean;
}) {
  // Sprint Z-2: 数値を大きく + 値ゼロ非ゼロでアクセントを変える
  const map: Record<typeof tone, { border: string; accent: string; valueColor: string }> = {
    blue: { border: 'border-l-blue-500', accent: 'text-blue-300', valueColor: 'text-blue-100' },
    green: { border: 'border-l-emerald-500', accent: 'text-emerald-300', valueColor: 'text-emerald-100' },
    orange: { border: 'border-l-orange-500', accent: 'text-orange-300', valueColor: 'text-orange-100' },
    violet: { border: 'border-l-violet-500', accent: 'text-violet-300', valueColor: 'text-violet-100' },
    red: { border: 'border-l-red-500', accent: 'text-red-300', valueColor: 'text-red-100' },
  };
  const tones = map[tone];
  // 0 件はやや控えめに、>0 は強調
  const isZero = value === 0;
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`rounded-md border bg-surface-panel border-l-4 ${tones.border} px-2.5 py-2 text-center transition-all ${
        isZero ? 'opacity-60' : 'opacity-100'
      } ${
        clickable
          ? 'cursor-pointer hover:bg-surface-base focus:outline-none focus:ring-2 focus:ring-accent-amber'
          : ''
      } ${active ? 'ring-2 ring-accent-amber border-accent-amber' : 'border-surface-border'}`}
    >
      <div className={`text-2xs font-bold ${tones.accent}`}>{label}</div>
      <div
        className={`text-2xl font-bold tabular-nums leading-tight mt-1 ${tones.valueColor}`}
      >
        {value}
        <small className="text-2xs font-normal ml-1 text-ink-muted">件</small>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 処理モーダル（mtoa-modal）
// ──────────────────────────────────────────────

function MatchActionModal({
  row,
  onClose,
  onComplete,
  onOpenDetail,
}: {
  row: MatchRow;
  onClose: () => void;
  onComplete: () => void;
  onOpenDetail: (pkNo: string) => void;
}) {
  const [pendingAction, setPendingAction] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc キー
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        if (pendingAction) setPendingAction(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingAction, busy, onClose]);

  function selectAction(kind: ActionKind) {
    setPendingAction(kind);
    setReason('');
    setError(null);
  }

  async function execute() {
    if (!pendingAction || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(row.pkNo)}/match-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: pendingAction, reason: reason.trim() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${r.status}`);
      }
      onComplete();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-surface-panel border-2 border-accent-amber rounded-[10px] shadow-modal max-w-xl w-full max-h-[90vh] overflow-auto">
        <div className="px-4 py-3 border-b border-surface-border flex justify-between items-center">
          <h3 className="text-sm font-bold text-ink-strong">⚙ 未検品伝票の処理</h3>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-ink-subtle hover:text-ink-strong text-xl"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* 伝票情報 */}
          <div className="bg-surface-base border border-surface-border rounded p-2 text-2xs space-y-0.5">
            <KVRow k="伝票No" v={<span className="font-mono text-accent-amber">{row.pkNo}</span>} />
            <KVRow
              k="納品書No"
              v={<span className="font-mono text-ink">{row.invoiceNo ?? '—'}</span>}
            />
            <KVRow k="顧客" v={row.destName ?? '—'} />
            <KVRow
              k="配送便"
              v={`${row.carrier?.name ?? '—'}${row.carrier?.cool ? ' ❄' : ''}`}
            />
            <KVRow k="担当" v={row.staffName ?? row.tableLabel ?? '—'} />
            <KVRow k="明細点数" v={`${row.itemCount} 点`} />
          </div>

          {pendingAction ? (
            // 理由入力フェーズ
            <div className="bg-surface-base border border-surface-border rounded p-3">
              <div className="text-[10px] text-accent-amber mb-1.5">
                ⚠ 処理理由を入力してください（必須）
                {' / '}
                選択中: {ACTION_DEFS.find((d) => d.kind === pendingAction)?.title}
              </div>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                disabled={busy}
                placeholder="例：在庫切れのためキャンセル／繁忙期で時間切れのため翌日繰越…"
                className="w-full bg-surface-panel border border-surface-border rounded px-2 py-1.5 text-2xs text-ink resize-none disabled:opacity-50"
                autoFocus
              />
              {error && (
                <div className="mt-2 text-2xs text-status-error">{error}</div>
              )}
              <div className="flex gap-2 justify-end mt-2">
                <button
                  onClick={() => setPendingAction(null)}
                  disabled={busy}
                  className="px-3 py-1 text-2xs rounded border border-surface-border bg-surface-panel text-ink hover:bg-surface-raised disabled:opacity-50"
                >
                  戻る
                </button>
                <button
                  onClick={execute}
                  disabled={busy || reason.trim().length === 0}
                  className="px-3 py-1 text-2xs rounded bg-orange-700 border border-orange-500 text-white font-bold hover:bg-orange-600 disabled:opacity-50"
                >
                  {busy ? '実行中…' : '✓ 実行'}
                </button>
              </div>
            </div>
          ) : (
            // アクション選択フェーズ
            <div>
              <div className="text-[10px] text-ink-subtle mb-1.5">
                この伝票に対して実行できる処理を選択してください
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {ACTION_DEFS.map((a) => (
                  <button
                    key={a.kind}
                    onClick={() => selectAction(a.kind)}
                    className={`text-left p-2 rounded border ${variantClass(a.variant)} hover:scale-[1.02] transition-transform`}
                  >
                    <div className="text-base">{a.icon}</div>
                    <div className="text-[10px] font-bold">{a.title}</div>
                    <div className="text-[9px] opacity-80 leading-tight mt-0.5">{a.desc}</div>
                  </button>
                ))}
                {/* 詳細は別扱い */}
                <button
                  onClick={() => onOpenDetail(row.pkNo)}
                  className={`text-left p-2 rounded border border-surface-border bg-surface-base text-ink hover:border-accent-amber`}
                >
                  <div className="text-base">📋</div>
                  <div className="text-[10px] font-bold">伝票詳細</div>
                  <div className="text-[9px] opacity-80 leading-tight mt-0.5">
                    明細／タイムラインを確認
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KVRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-1">
      <span className="text-ink-subtle">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  );
}

function AllocCell({ row }: { row: MatchRow }) {
  if (row.allocStatus === 'full') {
    return (
      <span className="text-status-ok text-[10px] font-bold">
        ✓ {row.allocatedQty}/{row.requiredQty}
      </span>
    );
  }
  if (row.allocStatus === 'partial') {
    return (
      <span className="text-accent-amber text-[10px] font-bold" title={`不足 ${row.allocDiff}`}>
        ⚠ {row.allocatedQty}/{row.requiredQty}
        <span className="text-3xs ml-0.5 opacity-80">(-{row.allocDiff})</span>
      </span>
    );
  }
  return (
    <span className="text-status-error text-[10px] font-bold" title={`未引当 ${row.requiredQty}`}>
      ✗ 0/{row.requiredQty}
    </span>
  );
}

function FilterPills({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{
    value: string;
    label: string;
    tone?: 'red' | 'emerald' | 'amber';
  }>;
  onChange: (v: string) => void;
}) {
  const toneClass: Record<'red' | 'emerald' | 'amber', string> = {
    red: 'text-red-200',
    emerald: 'text-emerald-200',
    amber: 'text-amber-200',
  };
  return (
    <div className="inline-flex border border-surface-border rounded overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-[10px] font-bold ${
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

function variantClass(v: 'success' | 'warn' | 'danger' | 'primary'): string {
  switch (v) {
    case 'success':
      return 'border-emerald-500/40 bg-emerald-950/30 text-emerald-100 hover:bg-emerald-900';
    case 'warn':
      return 'border-orange-500/40 bg-orange-950/30 text-orange-100 hover:bg-orange-900';
    case 'danger':
      return 'border-red-500/40 bg-red-950/30 text-red-100 hover:bg-red-900';
    case 'primary':
      return 'border-blue-500/40 bg-blue-950/30 text-blue-100 hover:bg-blue-900';
  }
}
