'use client';

/**
 * 🏭 製造連絡タブ（Sprint Z-3 → Z-4／旧称: 製造指示）
 *
 * 仕様（Z-4）:
 *  - 状態は「検品前 / 検品中（不足）/ 検品済 / 送信済 / 完成 / 取消」（draft の派生表示）
 *  - 承認は行ごとのチェックボックスで管理。全選択（一括承認）も可能
 *  - 「🚀 更新」ボタンで「承認済 & status in (draft,pending)」の指示をまとめて送信
 *  - 個別「送信」ボタンは廃止。送信は必ず承認 → 一括 のフロー
 *  - フィルタ: 状態 / 承認 / 種別 / 対象日
 *  - admin/manager のみ編集・送信可能（lead は閲覧のみ）
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useHasPermission } from '@/components/admin/role-context';

type DisplayStatus =
  | 'pre_inspection'
  | 'inspecting'
  | 'inspected'
  | 'sent'
  | 'completed'
  | 'cancelled';

interface MfgRow {
  id: number;
  instructionNo: string;
  productCode: string;
  productName: string;
  productJan: string | null;
  productType: string;
  qty: number;
  shortageQty: number;
  status: 'draft' | 'pending' | 'sent' | 'completed' | 'cancelled';
  displayStatus: DisplayStatus;
  approved: boolean;
  required: number;
  allocated: number;
  inspections: number;
  /** 対象日(ship_date)の最新 inbound(工場納品) 時刻（ISO・不足商品の納品時刻表示用） */
  lastDeliveryAt: string | null;
  targetDate: string;
  requestedBy: string | null;
  factoryRef: string | null;
  sentAt: string | null;
  completedAt: string | null;
  note: string | null;
  createdAt: string;
}

interface Summary {
  pre_inspection: number;
  inspecting: number;
  inspected: number;
  sent: number;
  completed: number;
  cancelled: number;
  approved: number;
  unapproved: number;
}

const STATUS_LABEL: Record<DisplayStatus, string> = {
  pre_inspection: '検品前',
  inspecting: '検品中（不足）',
  inspected: '検品済',
  sent: '送信済',
  completed: '完成',
  cancelled: '取消',
};

const STATUS_TONE: Record<
  DisplayStatus,
  { bg: string; text: string; border: string }
> = {
  pre_inspection: {
    bg: 'bg-amber-950/40',
    text: 'text-amber-200',
    border: 'border-amber-700',
  },
  inspecting: {
    bg: 'bg-orange-950/40',
    text: 'text-orange-200',
    border: 'border-orange-700',
  },
  inspected: {
    bg: 'bg-emerald-950/40',
    text: 'text-emerald-200',
    border: 'border-emerald-700',
  },
  sent: {
    bg: 'bg-violet-950/40',
    text: 'text-violet-200',
    border: 'border-violet-700',
  },
  completed: {
    bg: 'bg-emerald-950/40',
    text: 'text-emerald-200',
    border: 'border-emerald-700',
  },
  cancelled: {
    bg: 'bg-surface-base',
    text: 'text-ink-muted',
    border: 'border-surface-border',
  },
};

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function MfgPane() {
  const [items, setItems] = useState<MfgRow[]>([]);
  const [summary, setSummary] = useState<Summary>({
    pre_inspection: 0,
    inspecting: 0,
    inspected: 0,
    sent: 0,
    completed: 0,
    cancelled: 0,
    approved: 0,
    unapproved: 0,
  });
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [approvedFilter, setApprovedFilter] = useState<'' | 'true' | 'false'>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>(todayStr());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editTarget, setEditTarget] = useState<MfgRow | null>(null);
  const [updateDialog, setUpdateDialog] = useState<MfgRow[] | null>(null);
  const [cancelDialog, setCancelDialog] = useState<MfgRow | null>(null);

  const canEdit = useHasPermission('master_edit');

  const reload = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('displayStatus', statusFilter);
      if (approvedFilter) params.set('approved', approvedFilter);
      if (typeFilter) params.set('productType', typeFilter);
      if (dateFilter) params.set('date', dateFilter);
      const r = await fetch(`/api/mfg?${params.toString()}`);
      const j = await r.json();
      if (!r.ok) {
        setError(j?.message ?? `HTTP ${r.status}`);
        return;
      }
      setItems((j.data?.items ?? []) as MfgRow[]);
      setSummary((j.data?.summary ?? summary) as Summary);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, approvedFilter, typeFilter, dateFilter]);

  useEffect(() => {
    void reload();
    const id = setInterval(reload, 10000);
    return () => clearInterval(id);
  }, [reload]);

  // 承認候補（送信される対象）
  const approvedCandidates = useMemo(
    () =>
      items.filter(
        (m) =>
          m.approved &&
          (m.displayStatus === 'pre_inspection' ||
            m.displayStatus === 'inspecting' ||
            m.displayStatus === 'inspected'),
      ),
    [items],
  );

  // 承認可能な指示（フィルタ可視範囲のみ）
  const approvableItems = useMemo(
    () =>
      items.filter(
        (m) =>
          m.displayStatus === 'pre_inspection' ||
          m.displayStatus === 'inspecting' ||
          m.displayStatus === 'inspected',
      ),
    [items],
  );

  const allApprovedInView =
    approvableItems.length > 0 && approvableItems.every((m) => m.approved);

  async function setApproved(item: MfgRow, approved: boolean) {
    setBusy(true);
    try {
      const r = await fetch(`/api/mfg/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.message ?? `HTTP ${r.status}`);
        return;
      }
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function bulkApprove(ids: number[], approved: boolean) {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/mfg/bulk-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, approved }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.message ?? `HTTP ${r.status}`);
        return;
      }
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function bulkSend(targets: MfgRow[]) {
    setBusy(true);
    try {
      const r = await fetch(`/api/mfg/bulk-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: targets.map((t) => t.id),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.message ?? `HTTP ${r.status}`);
        return;
      }
      const dry = j.data?.dryRun ? '（DRY-RUN）' : '';
      alert(`✓ ${j.data?.sent ?? 0} 件を送信しました${dry}`);
      reload();
    } finally {
      setBusy(false);
      setUpdateDialog(null);
    }
  }

  async function cancel(item: MfgRow) {
    setBusy(true);
    try {
      const r = await fetch(`/api/mfg/${item.id}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.message ?? `HTTP ${r.status}`);
        return;
      }
      reload();
    } finally {
      setBusy(false);
      setCancelDialog(null);
    }
  }

  // 更新ボタン: 承認済みがあれば送信確認、無ければただリロード
  function handleUpdate() {
    if (approvedCandidates.length === 0) {
      reload();
      return;
    }
    setUpdateDialog(approvedCandidates);
  }

  return (
    <div className="p-3">
      {/* 状態カード */}
      <div className="grid grid-cols-6 gap-1.5 mb-2">
        <StatusCard
          label="検品前"
          value={summary.pre_inspection}
          tone="amber"
          active={statusFilter === 'pre_inspection'}
          onClick={() =>
            setStatusFilter(statusFilter === 'pre_inspection' ? '' : 'pre_inspection')
          }
        />
        <StatusCard
          label="検品中"
          value={summary.inspecting}
          tone="orange"
          active={statusFilter === 'inspecting'}
          onClick={() =>
            setStatusFilter(statusFilter === 'inspecting' ? '' : 'inspecting')
          }
        />
        <StatusCard
          label="検品済"
          value={summary.inspected}
          tone="emerald"
          active={statusFilter === 'inspected'}
          onClick={() =>
            setStatusFilter(statusFilter === 'inspected' ? '' : 'inspected')
          }
        />
        <StatusCard
          label="送信済"
          value={summary.sent}
          tone="violet"
          active={statusFilter === 'sent'}
          onClick={() => setStatusFilter(statusFilter === 'sent' ? '' : 'sent')}
        />
        <StatusCard
          label="完成"
          value={summary.completed}
          tone="emerald"
          active={statusFilter === 'completed'}
          onClick={() =>
            setStatusFilter(statusFilter === 'completed' ? '' : 'completed')
          }
        />
        <StatusCard
          label="取消"
          value={summary.cancelled}
          tone="muted"
          active={statusFilter === 'cancelled'}
          onClick={() =>
            setStatusFilter(statusFilter === 'cancelled' ? '' : 'cancelled')
          }
        />
      </div>

      {/* フィルタ + 操作 */}
      <div className="flex items-center gap-2 mb-2 text-xs flex-wrap">
        <label className="text-ink-subtle">対象日:</label>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono"
        />
        <button
          type="button"
          onClick={() => setDateFilter('')}
          className="text-2xs text-ink-subtle hover:text-ink"
        >
          全期間
        </button>

        <span className="ml-2 text-ink-subtle">承認:</span>
        <FilterPills
          value={approvedFilter}
          options={[
            { value: '', label: '全て' },
            { value: 'true', label: '承認済' },
            { value: 'false', label: '未承認' },
          ]}
          onChange={(v) => setApprovedFilter(v as '' | 'true' | 'false')}
        />

        <span className="ml-2 text-ink-subtle">種別:</span>
        <FilterPills
          value={typeFilter}
          options={[
            { value: '', label: '全て' },
            { value: 'pass_through', label: '通過型' },
            { value: 'warehouse', label: '倉庫' },
            { value: 'made_to_order', label: '受注生産' },
          ]}
          onChange={setTypeFilter}
        />

        <div className="flex-1" />

        {canEdit && approvableItems.length > 0 && (
          <button
            type="button"
            onClick={() =>
              bulkApprove(
                approvableItems.map((i) => i.id),
                !allApprovedInView,
              )
            }
            disabled={busy}
            className="text-2xs px-2 py-1 rounded border border-blue-500 bg-blue-900 text-blue-100 hover:bg-blue-800 disabled:opacity-50"
          >
            {allApprovedInView ? '☐ 全解除' : '☑ 全承認'}
          </button>
        )}

        <button
          type="button"
          onClick={handleUpdate}
          disabled={busy}
          className={`px-3 py-1 rounded text-xs font-bold border disabled:opacity-50 ${
            approvedCandidates.length > 0
              ? 'border-violet-500 bg-violet-900 text-violet-100 hover:bg-violet-800'
              : 'border-surface-border bg-surface-base hover:border-accent-amber'
          }`}
          title={
            approvedCandidates.length > 0
              ? `${approvedCandidates.length} 件の承認済を送信します`
              : '更新（承認済が無いためリロードのみ）'
          }
        >
          🚀 更新
          {approvedCandidates.length > 0 && (
            <span className="ml-1 px-1 rounded bg-white/15 tabular-nums">
              {approvedCandidates.length}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div className="mb-2 p-2 text-xs bg-status-error-bg text-status-error border border-status-error rounded">
          {error}
        </div>
      )}

      {/* 一覧 */}
      <div className="border border-surface-border rounded">
        <table className="w-full text-xs">
          <thead className="bg-surface-base border-b border-surface-border sticky top-0 z-10">
            <tr>
              <th className="px-2 py-2 text-center text-2xs uppercase text-ink-subtle font-bold w-10">
                {canEdit && approvableItems.length > 0 && (
                  <input
                    type="checkbox"
                    checked={allApprovedInView}
                    onChange={(e) =>
                      bulkApprove(
                        approvableItems.map((i) => i.id),
                        e.target.checked,
                      )
                    }
                    title="一括承認"
                  />
                )}
              </th>
              <th className="px-2 py-2 text-left text-2xs uppercase text-ink-subtle font-bold">
                指示№
              </th>
              <th className="px-2 py-2 text-left text-2xs uppercase text-ink-subtle font-bold">
                対象日
              </th>
              <th className="px-2 py-2 text-left text-2xs uppercase text-ink-subtle font-bold">
                商品
              </th>
              <th className="px-2 py-2 text-right text-2xs uppercase text-ink-subtle font-bold">
                数量
              </th>
              <th className="px-2 py-2 text-right text-2xs uppercase text-ink-subtle font-bold">
                引当 / 必要
              </th>
              <th className="px-2 py-2 text-right text-2xs uppercase text-ink-subtle font-bold">
                最終納品
              </th>
              <th className="px-2 py-2 text-center text-2xs uppercase text-ink-subtle font-bold">
                状態
              </th>
              <th className="px-2 py-2 text-right text-2xs uppercase text-ink-subtle font-bold">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="text-center py-8 text-sm text-ink-muted"
                >
                  該当する製造連絡はありません
                </td>
              </tr>
            )}
            {items.map((m) => {
              const tone = STATUS_TONE[m.displayStatus];
              const editable =
                m.displayStatus === 'pre_inspection' ||
                m.displayStatus === 'inspecting' ||
                m.displayStatus === 'inspected';
              return (
                <tr
                  key={m.id}
                  className={`border-t border-surface-border hover:bg-surface-base ${
                    m.approved ? 'bg-blue-950/20' : ''
                  }`}
                >
                  <td className="px-2 py-1.5 text-center">
                    {canEdit && editable && (
                      <input
                        type="checkbox"
                        checked={m.approved}
                        onChange={(e) => setApproved(m, e.target.checked)}
                        disabled={busy}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-2xs text-accent-amber">
                    {m.instructionNo}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-2xs">
                    {m.targetDate}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-bold text-ink-strong truncate max-w-[260px]">
                      {m.productName}
                    </div>
                    <div className="text-3xs text-ink-muted font-mono truncate">
                      {m.productCode}
                      {m.productJan && ` / ${m.productJan}`}
                      <span className="ml-2">
                        {m.productType === 'pass_through'
                          ? '通過型'
                          : m.productType === 'made_to_order'
                            ? '受注生産'
                            : '倉庫'}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-mono font-bold">
                    {m.qty}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-mono text-2xs">
                    <span
                      className={
                        m.allocated >= m.required
                          ? 'text-status-ok font-bold'
                          : m.allocated > 0
                            ? 'text-accent-amber'
                            : 'text-status-error'
                      }
                    >
                      {m.allocated}
                    </span>
                    <span className="text-ink-muted"> / {m.required}</span>
                    {m.inspections > 0 && (
                      <div className="text-3xs text-ink-muted">
                        検品 {m.inspections} 回
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-2xs tabular-nums">
                    {m.lastDeliveryAt ? (
                      <span className="text-ink-strong">
                        {new Date(m.lastDeliveryAt).toLocaleTimeString('ja-JP', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                      </span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-2xs font-bold border ${tone.bg} ${tone.text} ${tone.border}`}
                    >
                      {STATUS_LABEL[m.displayStatus]}
                    </span>
                    {m.approved && editable && (
                      <div className="text-3xs text-blue-300 font-bold mt-0.5">
                        ☑ 承認済
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {canEdit && (
                      <div className="inline-flex gap-1">
                        {editable && (
                          <button
                            type="button"
                            onClick={() => setEditTarget(m)}
                            disabled={busy}
                            className="text-2xs px-2 py-1 rounded border border-surface-border bg-surface-panel hover:border-accent-amber disabled:opacity-50"
                          >
                            ✏ 編集
                          </button>
                        )}
                        {m.displayStatus !== 'completed' &&
                          m.displayStatus !== 'cancelled' && (
                            <button
                              type="button"
                              onClick={() => setCancelDialog(m)}
                              disabled={busy}
                              className="text-2xs px-2 py-1 rounded border border-status-error bg-red-950 text-red-200 hover:bg-red-900 disabled:opacity-50"
                            >
                              ✗ 取消
                            </button>
                          )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-3xs text-ink-muted">
        ※ 承認チェック → 「🚀 更新」ボタンで一括送信。送信後は status=送信済 に変わり、編集できなくなります。
        FACTORY_DRY_RUN=true の場合は実機送信せず status のみ更新します。
      </p>

      {/* 編集モーダル */}
      {editTarget && (
        <EditModal
          item={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            reload();
          }}
        />
      )}

      {/* 更新（一括送信）確認 */}
      <ConfirmDialog
        open={!!updateDialog}
        title={`承認済 ${updateDialog?.length ?? 0} 件を工場へ送信しますか？`}
        body={
          updateDialog ? (
            <div className="space-y-2 text-sm max-h-72 overflow-auto">
              <ul className="text-xs space-y-0.5 border border-surface-border rounded p-2 bg-surface-base">
                {updateDialog.map((m) => (
                  <li key={m.id} className="flex justify-between gap-2">
                    <span className="font-mono text-2xs text-accent-amber min-w-[120px]">
                      {m.instructionNo}
                    </span>
                    <span className="flex-1 truncate">{m.productName}</span>
                    <span className="font-mono tabular-nums">
                      {m.qty} 個
                    </span>
                  </li>
                ))}
              </ul>
              <div className="text-2xs text-ink-muted">
                ※ 送信後は編集できません。
              </div>
            </div>
          ) : null
        }
        confirmLabel="🚀 送信"
        variant="success"
        onConfirm={() => {
          if (updateDialog) void bulkSend(updateDialog);
        }}
        onCancel={() => setUpdateDialog(null)}
      />

      {/* 取消確認 */}
      <ConfirmDialog
        open={!!cancelDialog}
        title={`${cancelDialog?.instructionNo} を取消しますか？`}
        body={
          cancelDialog ? (
            <div className="space-y-1 text-sm">
              <div>
                商品: <b>{cancelDialog.productName}</b>
              </div>
              <div>
                数量: <b>{cancelDialog.qty}</b> 個
              </div>
              <div className="text-status-warn text-2xs">
                ⚠ 取消すると status=cancelled となり、送信できなくなります。
              </div>
            </div>
          ) : null
        }
        confirmLabel="✗ 取消"
        variant="danger"
        onConfirm={() => {
          if (cancelDialog) void cancel(cancelDialog);
        }}
        onCancel={() => setCancelDialog(null)}
      />
    </div>
  );
}

function FilterPills({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex border border-surface-border rounded overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-2 py-1 text-2xs ${
            value === opt.value
              ? 'bg-accent-amber text-surface-base font-bold'
              : 'bg-surface-base hover:bg-surface-panel text-ink-subtle'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function StatusCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: 'amber' | 'orange' | 'emerald' | 'violet' | 'muted';
  active: boolean;
  onClick: () => void;
}) {
  const map = {
    amber: { border: 'border-l-amber-500', text: 'text-amber-200' },
    orange: { border: 'border-l-orange-500', text: 'text-orange-200' },
    emerald: { border: 'border-l-emerald-500', text: 'text-emerald-200' },
    violet: { border: 'border-l-violet-500', text: 'text-violet-200' },
    muted: { border: 'border-l-surface-border', text: 'text-ink-muted' },
  };
  const t = map[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border ${
        active ? 'border-accent-amber' : 'border-surface-border'
      } bg-surface-panel border-l-4 ${t.border} px-2 py-1.5 text-center transition-all hover:bg-surface-raised`}
    >
      <div className={`text-2xs font-bold ${t.text}`}>{label}</div>
      <div
        className={`text-xl font-bold tabular-nums leading-tight mt-0.5 ${
          value > 0 ? 'text-ink-strong' : 'text-ink-muted'
        }`}
      >
        {value}
        <small className="text-2xs font-normal ml-1 text-ink-muted">件</small>
      </div>
    </button>
  );
}

function EditModal({
  item,
  onClose,
  onSaved,
}: {
  item: MfgRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [qty, setQty] = useState(item.qty);
  const [note, setNote] = useState(item.note ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`/api/mfg/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty, note }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.message ?? `HTTP ${r.status}`);
        return;
      }
      onSaved();
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
      <div className="bg-surface-panel border-2 border-accent-amber rounded-[10px] shadow-modal max-w-md w-full p-5">
        <h3 className="text-sm font-bold text-accent-amber mb-1">
          🏭 製造連絡 編集
        </h3>
        <p className="text-2xs text-ink-muted mb-4">{item.instructionNo}</p>

        <div className="space-y-3">
          <div>
            <label className="text-2xs text-ink-subtle block mb-1">商品</label>
            <div className="text-sm font-bold">{item.productName}</div>
            <div className="text-3xs font-mono text-ink-muted">
              {item.productCode}
            </div>
          </div>
          <div>
            <label className="text-2xs text-ink-subtle block mb-1">対象日</label>
            <div className="text-sm font-mono">{item.targetDate}</div>
          </div>
          <div>
            <label className="text-2xs text-ink-subtle block mb-1">数量</label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(parseInt(e.target.value, 10) || 0)}
              className="w-full bg-surface-base border border-surface-border rounded px-3 py-2 text-base font-mono text-center"
            />
          </div>
          <div>
            <label className="text-2xs text-ink-subtle block mb-1">備考</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full bg-surface-base border border-surface-border rounded px-2 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-surface-border bg-surface-base text-xs disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || qty < 1}
            className="px-4 py-1.5 rounded bg-brand-primary text-white text-xs font-bold disabled:opacity-50"
          >
            {busy ? '保存中…' : '✓ 保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
