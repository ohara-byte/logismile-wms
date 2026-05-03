'use client';

/**
 * ⚠ 強制OK 承認タブ
 *
 * モック準拠（管理用PCモック_v0.22.html L2526-2601 + .force-item スタイル L463-492）
 *
 * 仕様:
 *  - GET /api/force-ok で 未承認 + 当日処理済 を取得（5秒ポーリング）
 *  - サマリ行: 未承認 N件 / 本日累計 / R01 除外バッジ
 *  - 未承認カード（urgent 赤枠）
 *      ・ピッキングNo / 発生時刻 / テーブル(運送会社) / 担当
 *      ・商品名 / 商品コード / JAN
 *      ・理由コード R01-R04/R99 + 理由テキスト
 *      ・✓ 承認 / ✗ 却下 / 詳細 ボタン
 *      ・承認: 二重確認 → POST /approve
 *      ・却下: 理由 textarea 必須 → POST /reject
 *  - 承認済（本日）セクション
 *  - 操作後 BadgeContext.refresh() で即時バッジ更新
 */

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useBadges } from '@/components/admin/badge-context';
import {
  FORCE_REASON_LABELS,
  reasonBadgeClass,
  type ForceReasonCode,
} from '@/lib/force-ok';

interface ForceItem {
  itemId: number;
  pkNo: string;
  productCode: string;
  productName: string;
  jan: string | null;
  qty: number;
  carrier: { code: string; name: string; short: string | null; cool: boolean } | null;
  triggerStaff: { code: string; name: string } | null;
  triggeredAt: string | null;
  reasonCode: ForceReasonCode | null;
  reason: string | null;
  approvalStatus: 'approved' | 'rejected' | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
}

interface Summary {
  pending: number;
  todayApproved: number;
  todayRejected: number;
  todayTotal: number;
}

type DialogMode = 'approve' | 'reject';

export function ForcePane() {
  const [pending, setPending] = useState<ForceItem[] | null>(null);
  const [todayResolved, setTodayResolved] = useState<ForceItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: DialogMode; item: ForceItem } | null>(null);
  const { refresh: refreshBadges } = useBadges();

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/force-ok');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setPending(j.data?.pending ?? []);
      setTodayResolved(j.data?.todayResolved ?? []);
      setSummary(j.data?.summary ?? null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [reload]);

  async function performApprove(item: ForceItem) {
    const r = await fetch(`/api/force-ok/${item.itemId}/approve`, { method: 'POST' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.message ?? `HTTP ${r.status}`);
    }
  }

  async function performReject(item: ForceItem, reason: string) {
    const r = await fetch(`/api/force-ok/${item.itemId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.message ?? `HTTP ${r.status}`);
    }
  }

  async function onConfirmDialog(promptValue: string) {
    if (!dialog) return;
    try {
      // 楽観更新
      setPending((prev) => (prev ?? []).filter((i) => i.itemId !== dialog.item.itemId));
      if (dialog.mode === 'approve') {
        await performApprove(dialog.item);
      } else {
        await performReject(dialog.item, promptValue);
      }
      refreshBadges();
      reload();
    } catch (e) {
      setError(String(e));
      reload(); // 巻き戻し
    } finally {
      setDialog(null);
    }
  }

  if (pending === null) {
    return (
      <div className="p-3 text-2xs text-ink-muted flex items-center gap-2">
        <span className="w-1.5 h-1.5 bg-accent-amber rounded-full animate-pulse" />
        読み込み中…
      </div>
    );
  }

  return (
    <div className="p-3">
      {/* サマリ行 */}
      <div className="text-2xs text-ink-subtle mb-2 leading-relaxed">
        ⚠ 未承認{' '}
        <b className="text-status-error">{summary?.pending ?? 0}件</b> ／ 本日累計{' '}
        {summary?.todayTotal ?? 0}件
        <span className="ml-2 inline-block px-2 py-0.5 bg-surface-base border border-surface-border rounded-full text-[10px] text-ink-muted">
          ⛔ R01 セット品時間制約は<b className="text-ink">日常運用のため除外</b>（一覧 / レポート対象外）
        </span>
      </div>

      {error && (
        <div className="mb-2 p-2 text-2xs bg-status-error-bg text-status-error border border-status-error rounded">
          {error}
        </div>
      )}

      {/* 未承認カード群 */}
      {pending.length === 0 ? (
        <div className="text-center py-6">
          <div className="text-3xl mb-2 opacity-50">✅</div>
          <p className="text-2xs text-ink-muted">未承認の強制OK はありません</p>
        </div>
      ) : (
        pending.map((it) => (
          <ForceCard
            key={it.itemId}
            item={it}
            onApprove={() => setDialog({ mode: 'approve', item: it })}
            onReject={() => setDialog({ mode: 'reject', item: it })}
          />
        ))
      )}

      {/* 承認済（本日）セクション */}
      {todayResolved.length > 0 && (
        <div className="border-t border-surface-border mt-3 pt-2">
          <div className="text-[10px] text-ink-muted mb-1.5">承認済 / 却下済（本日）</div>
          {todayResolved.map((it) => (
            <ResolvedCard key={it.itemId} item={it} />
          ))}
        </div>
      )}

      {/* 二重確認ダイアログ */}
      <ConfirmDialog
        open={dialog?.mode === 'approve'}
        title="強制OK を承認しますか？"
        body={
          dialog?.item ? (
            <div className="space-y-1">
              <div>
                <span className="text-ink-muted">PkNo: </span>
                <span className="font-mono text-accent-amber">{dialog.item.pkNo}</span>
              </div>
              <div>
                <span className="text-ink-muted">商品: </span>
                {dialog.item.productName}
              </div>
              <div>
                <span className="text-ink-muted">理由: </span>
                {dialog.item.reasonCode ? `${dialog.item.reasonCode} ` : ''}
                {dialog.item.reason}
              </div>
            </div>
          ) : null
        }
        confirmLabel="✓ 承認"
        variant="success"
        onConfirm={onConfirmDialog}
        onCancel={() => setDialog(null)}
      />

      <ConfirmDialog
        open={dialog?.mode === 'reject'}
        title="強制OK を却下しますか？"
        body={
          dialog?.item ? (
            <div className="space-y-1">
              <div>
                <span className="text-ink-muted">PkNo: </span>
                <span className="font-mono text-accent-amber">{dialog.item.pkNo}</span>
              </div>
              <div>
                <span className="text-ink-muted">商品: </span>
                {dialog.item.productName}
              </div>
              <div className="text-status-warn">
                ⚠ 却下しても scannedQty は戻りません。現場フォロー用の高優先アラートを起票します。
              </div>
            </div>
          ) : null
        }
        confirmLabel="✗ 却下"
        variant="danger"
        promptLabel="却下理由（必須）"
        promptPlaceholder="例: R02 だが現物確認が取れず再検品が必要"
        onConfirm={onConfirmDialog}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}

function ForceCard({
  item,
  onApprove,
  onReject,
}: {
  item: ForceItem;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="bg-surface-base border border-status-error rounded mb-1.5 px-2.5 py-2">
      <div className="flex justify-between text-[10px] text-ink-muted mb-1">
        <span className="font-mono font-bold text-accent-amber">{item.pkNo}</span>
        <span>
          {formatTime(item.triggeredAt)} ／{' '}
          {item.carrier ? `${item.carrier.short ?? item.carrier.name}` : '—'}
          {item.carrier?.cool && ' ❄'} ／{' '}
          {item.triggerStaff ? item.triggerStaff.name : '—'}
        </span>
      </div>
      <div className="text-xs text-ink-strong">
        {item.productName}
        <div className="text-[10px] text-ink-muted font-mono">
          {item.productCode} ／ JAN: {item.jan ?? '—'} ／ 数量 {item.qty}
        </div>
      </div>
      <div className="text-[10px] text-ink mt-1.5 flex items-center gap-1">
        {item.reasonCode && (
          <span
            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${reasonBadgeClass(item.reasonCode)}`}
          >
            {item.reasonCode}
          </span>
        )}
        <span className="flex-1 leading-snug">
          {item.reason ?? '（理由未入力）'}
          {item.reasonCode && (
            <span className="text-ink-muted ml-1">
              ({FORCE_REASON_LABELS[item.reasonCode]})
            </span>
          )}
        </span>
      </div>
      <div className="flex gap-1 mt-2">
        <button
          onClick={onApprove}
          className="flex-1 text-xs font-bold py-1 rounded border border-status-ok bg-emerald-900 text-emerald-200 hover:bg-status-ok hover:text-white"
        >
          ✓ 承認
        </button>
        <button
          onClick={onReject}
          className="flex-1 text-xs font-bold py-1 rounded border border-status-error bg-red-900 text-red-200 hover:bg-status-error hover:text-white"
        >
          ✗ 却下
        </button>
        <button
          className="text-xs font-bold py-1 px-3 rounded border border-surface-border bg-surface-panel text-ink hover:border-accent-amber"
          title="伝票詳細モーダル（A-13 で実装予定）"
          disabled
        >
          詳細
        </button>
      </div>
    </div>
  );
}

function ResolvedCard({ item }: { item: ForceItem }) {
  const isApproved = item.approvalStatus === 'approved';
  return (
    <div className="bg-surface-base border border-surface-border rounded mb-1 px-2.5 py-1.5 opacity-80">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span
          className={`font-mono font-bold ${isApproved ? 'text-status-ok' : 'text-status-error'}`}
        >
          {isApproved ? '✓' : '✗'} {item.pkNo}
        </span>
        <span className="text-ink-muted">
          {formatTime(item.approvedAt)} ／{' '}
          {item.triggerStaff?.name ?? '—'} →{' '}
          {isApproved ? '承認' : '却下'}: {item.approvedBy ?? '—'}
        </span>
      </div>
      <div className="text-[10px] text-ink-subtle flex items-center gap-1">
        {item.reasonCode && (
          <span
            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${reasonBadgeClass(item.reasonCode)}`}
          >
            {item.reasonCode}
          </span>
        )}
        <span className="flex-1 leading-snug truncate">
          {item.reason ?? ''}
          {!isApproved && item.rejectReason && (
            <span className="text-status-error ml-1">／ 却下理由: {item.rejectReason}</span>
          )}
        </span>
      </div>
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
