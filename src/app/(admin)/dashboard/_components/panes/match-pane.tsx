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
  matchStatus: 'none' | 'barcode' | 'visual';
  matchedAt: string | null;
  matchedBy: string | null;
}

interface Stats {
  total: number;
  done: number;
  pending: number;
  matched: number;
  carryCandidate: number;
}

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
  const [carryDialog, setCarryDialog] = useState(false);

  const { refresh: refreshBadges } = useBadges();
  const { open: openOrderDetail } = useOrderDetailModal();

  const reload = useCallback(async () => {
    try {
      const r = await fetch(`/api/orders/match?date=${date}`);
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
  }, [date]);

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

  async function executeCarryover(reason: string) {
    setBusy(true);
    try {
      const r = await fetch('/api/orders/match/carryover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, reason }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j?.message ?? `HTTP ${r.status}`);
        return;
      }
      alert(`✅ ${j.data.affected} 件を翌日へ繰越しました`);
      refreshBadges();
      reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setCarryDialog(false);
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
          <StatBox label="総件数" value={data.stats.total} tone="blue" />
          <StatBox label="検品済" value={data.stats.done} tone="green" />
          <StatBox label="未検品" value={data.stats.pending} tone="orange" />
          <StatBox label="照合済" value={data.stats.matched} tone="violet" />
          <StatBox label="繰越候補" value={data.stats.carryCandidate} tone="red" />
        </div>
      )}

      {/* 翌日繰越アクションバー */}
      {matchedCount > 0 && (
        <div className="mb-2 px-2.5 py-1.5 rounded border border-status-warn/50 bg-amber-950/30 flex items-center justify-between">
          <div className="text-[10px] text-amber-100">
            ✓ <b>{matchedCount}</b> 件の未検品伝票が照合済みです。
            <b>翌日繰越処理を実行</b>すると、これらの伝票は明日へ繰越されます。
          </div>
          <button
            onClick={() => setCarryDialog(true)}
            disabled={busy}
            className="px-2.5 py-1 rounded bg-orange-700 border border-orange-500 text-white text-[10px] font-bold hover:bg-orange-600 whitespace-nowrap"
          >
            🟠 翌日繰越を実行
          </button>
        </div>
      )}

      {/* 一覧テーブル */}
      {data && (
        <div className="border border-surface-border rounded overflow-hidden">
          <table className="w-full text-[10px]">
            <thead className="bg-surface-base border-b border-surface-border">
              <tr>
                <th className="px-1.5 py-1 text-center w-[80px] uppercase text-ink-subtle font-bold">📷</th>
                <th className="px-1.5 py-1 text-center w-[44px] uppercase text-ink-subtle font-bold">👁</th>
                <th className="px-1.5 py-1 text-left uppercase text-ink-subtle font-bold">伝票No</th>
                <th className="px-1.5 py-1 text-left uppercase text-ink-subtle font-bold">納品書</th>
                <th className="px-1.5 py-1 text-left uppercase text-ink-subtle font-bold">顧客</th>
                <th className="px-1.5 py-1 text-left uppercase text-ink-subtle font-bold">便</th>
                <th className="px-1.5 py-1 text-center uppercase text-ink-subtle font-bold">担当</th>
                <th className="px-1.5 py-1 text-right uppercase text-ink-subtle font-bold">点</th>
                <th className="px-1.5 py-1 text-center uppercase text-ink-subtle font-bold">状態</th>
                <th className="px-1.5 py-1 text-center uppercase text-ink-subtle font-bold">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="text-center py-6 text-ink-muted text-2xs"
                  >
                    対象日の伝票がありません
                  </td>
                </tr>
              ) : (
                data.items.map((row) => (
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
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 翌日繰越 確認ダイアログ */}
      <ConfirmDialog
        open={carryDialog}
        title="翌日繰越を実行しますか？"
        body={
          <div className="space-y-1 text-2xs">
            <div>
              照合済の<b className="text-accent-amber">{matchedCount}件</b>
              の未検品伝票を 明日（{nextDate(date)}）の出荷指示として繰越します。
            </div>
            <div className="text-status-warn">
              ⚠ 元に戻す機能はありません。実行前にご確認ください。
            </div>
          </div>
        }
        promptLabel="繰越理由（必須）"
        promptPlaceholder="例: 繁忙期で時間切れのため翌日繰越"
        confirmLabel="🟠 一括繰越実行"
        variant="warn"
        onConfirm={executeCarryover}
        onCancel={() => setCarryDialog(false)}
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
  const total = items.length;
  const done = items.filter((i) => i.inspected).length;
  const pending = total - done;
  const matched = items.filter((i) => i.matchStatus !== 'none').length;
  const carryCandidate = items.filter((i) => !i.inspected && i.matchStatus !== 'none').length;
  return { total, done, pending, matched, carryCandidate };
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
}: {
  row: MatchRow;
  onBarcode: () => void;
  onVisual: () => void;
  onAction: () => void;
}) {
  const rowCls = row.inspected
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
      <td className="px-1.5 py-1 font-mono text-accent-amber tabular-nums">{row.pkNo}</td>
      <td className="px-1.5 py-1 font-mono text-ink-subtle">{row.invoiceNo ?? '—'}</td>
      <td className="px-1.5 py-1 truncate max-w-[140px]" title={row.destName ?? ''}>
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
}: {
  label: string;
  value: number;
  tone: 'blue' | 'green' | 'orange' | 'violet' | 'red';
}) {
  const map = {
    blue: 'border-blue-500/40 bg-blue-950/30 text-blue-200',
    green: 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200',
    orange: 'border-orange-500/40 bg-orange-950/30 text-orange-200',
    violet: 'border-violet-500/40 bg-violet-950/30 text-violet-200',
    red: 'border-red-500/40 bg-red-950/30 text-red-200',
  };
  return (
    <div className={`rounded border ${map[tone]} px-2 py-1.5 text-center`}>
      <div className="text-[9px] text-ink-muted">{label}</div>
      <div className="text-base font-bold tabular-nums leading-none mt-0.5">
        {value}
        <small className="text-[10px] font-normal ml-0.5">件</small>
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
      <div className="bg-surface-panel border border-surface-border rounded-2xl shadow-modal max-w-xl w-full max-h-[90vh] overflow-auto">
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
