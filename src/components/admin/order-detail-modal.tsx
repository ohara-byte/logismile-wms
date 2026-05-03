'use client';

/**
 * 伝票詳細モーダル（odModal）
 *
 * モック準拠（管理用PCモック_v0.22.html L4902-5016）。
 *
 * 構成:
 *   1. ヘッダ: ピッキング№（プリフィックス強調）+ 状態バッジ
 *   2. 2 カラム: お客様情報 / 出荷情報
 *   3. 親商品ヘッダ（構成品マスタ逆引き ─ 該当時のみ）※将来
 *   4. 明細表（商品コード / 名 / 数 / 状態）
 *   5. 処理アクション 5 種: 編集 / 前倒し / 繰越 / 再印刷 / キャンセル
 *   6. 作業テーブルへメッセージ送信（テンプレ + 本文 + 送信）
 *   7. タイムライン（CSV 取込 / 印刷 / 着手 / 完了 / 強制OK / 監査ログ）
 *
 * 操作:
 *   - 再印刷: POST /api/print/qr/reprint
 *   - キャンセル: DELETE /api/orders/[pkNo] (理由必須)
 *   - 編集 / 前倒し / 繰越 は将来ブロック（alert で告知）
 *   - メッセージ送信: POST /api/notices (kind=announce)
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useBadges } from './badge-context';
import {
  reasonBadgeClass,
  type ForceReasonCode,
} from '@/lib/force-ok';

interface OrderItem {
  id: number;
  productCode: string;
  productName: string;
  qty: number;
  scannedQty: number;
  forceOk: boolean;
  forceReason: string | null;
  forceReasonCode: ForceReasonCode | null;
  forceApprovalStatus: 'approved' | 'rejected' | null;
  product: { jan: string | null; frozen: boolean; special: boolean };
}

interface OrderDetail {
  id: string;
  pkNo: string;
  shipDate: string;
  status: string;
  qrPrintFlag: boolean;
  invoiceNo: string | null;
  noshiName: string | null;
  destName: string | null;
  destZip: string | null;
  destAddr: string | null;
  holdReason: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
  carrier: { code: string; name: string; short: string | null; cool: boolean } | null;
  items: OrderItem[];
  inspSession: {
    id: string;
    staffCode: string;
    deviceCode: string | null;
    startedAt: string;
    completedAt: string | null;
    boxCode: string | null;
    staff: { code: string; name: string } | null;
    device: { code: string; name: string; type: string; location: string | null } | null;
  } | null;
}

interface TimelineEvent {
  at: string;
  kind: string;
  icon: string;
  message: string;
  actor: string | null;
}

interface Props {
  pkNo: string;
  onClose: () => void;
}

const MSG_TEMPLATES: { label: string; text: string }[] = [
  { label: '保留指示', text: 'この伝票は保留し、後続に回してください。' },
  { label: '再スキャン依頼', text: '内容を修正しました。再スキャンお願いします。' },
  { label: '中止（キャンセル）', text: 'お客様都合によりキャンセルです。梱包中止してください。' },
  { label: '前倒し', text: '前倒し処理です。本日分として扱ってください。' },
  { label: '繰越', text: '翌日繰越としました。対象から除外してください。' },
  { label: '優先対応', text: '冷凍便・特殊梱包です。優先対応お願いします。' },
];

export function OrderDetailModal({ pkNo, onClose }: Props) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);

  // メッセージ送信フォーム
  const [msgTo, setMsgTo] = useState<'table' | 'group' | 'tablet' | 'all'>('table');
  const [msgBody, setMsgBody] = useState('');
  const [msgAck, setMsgAck] = useState(true);
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgFlash, setMsgFlash] = useState<string | null>(null);

  const { refresh: refreshBadges } = useBadges();

  const reload = useCallback(async () => {
    try {
      const [oRes, tRes] = await Promise.all([
        fetch(`/api/orders/${encodeURIComponent(pkNo)}`),
        fetch(`/api/orders/${encodeURIComponent(pkNo)}/timeline`),
      ]);
      const oJson = await oRes.json();
      if (!oRes.ok) {
        setError(oJson.message ?? `HTTP ${oRes.status}`);
        return;
      }
      setOrder(oJson.data);
      const tJson = await tRes.json();
      setTimeline(tJson.data?.items ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [pkNo]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Esc キーで閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !cancelDialog) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy, cancelDialog]);

  async function onReprint() {
    if (!order) return;
    if (!confirm('QR ラベルを再印刷します。よろしいですか？')) return;
    setBusy(true);
    try {
      const r = await fetch('/api/print/qr/reprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pkNo: order.pkNo }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j?.message ?? `エラー: HTTP ${r.status}`);
      } else {
        reload();
      }
    } finally {
      setBusy(false);
    }
  }

  async function onCancel(reason: string) {
    if (!order) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(order.pkNo)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j?.message ?? `エラー: HTTP ${r.status}`);
      } else {
        refreshBadges();
        reload();
      }
    } finally {
      setBusy(false);
      setCancelDialog(false);
    }
  }

  async function onSendMessage() {
    if (!order || !msgBody.trim()) return;
    setMsgBusy(true);
    setMsgFlash(null);
    try {
      const target = msgTo === 'all' ? 'all' : msgTo === 'tablet' ? 'tablet' : 'staff';
      const targetId =
        msgTo === 'group'
          ? 'group' // TODO: グループ ID を組み立てる仕組みが要件次第（現状は staff_code 直指定の代替）
          : msgTo === 'table' && order.inspSession?.staff?.code
            ? order.inspSession.staff.code
            : null;
      const r = await fetch('/api/notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'announce',
          date: new Date().toISOString().slice(0, 10),
          targetType: target,
          targetId,
          title: `📨 ${order.pkNo}`,
          body: msgBody.trim(),
          ackRequired: msgAck,
          priority: 70,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setMsgFlash(j?.message ?? `エラー: HTTP ${r.status}`);
      } else {
        setMsgBody('');
        setMsgFlash('✅ 送信しました');
        setTimeout(() => setMsgFlash(null), 2500);
      }
    } catch (e) {
      setMsgFlash(String(e));
    } finally {
      setMsgBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/65 flex items-center justify-center z-40 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy && !cancelDialog) onClose();
      }}
    >
      <div className="bg-surface-panel border border-surface-border rounded-2xl shadow-modal max-w-3xl w-full max-h-[92vh] overflow-auto">
        {/* ヘッダ */}
        <div className="sticky top-0 bg-surface-panel border-b border-surface-border px-5 py-3 flex justify-between items-center z-10">
          <div className="flex items-baseline gap-2">
            <span className="text-3xs text-ink-subtle uppercase">PkNo</span>
            <h2 className="text-base font-bold font-mono text-accent-amber tabular-nums">
              {pkNo}
              {pkNoPrefix(pkNo) && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-surface-base text-xs text-ink-subtle rounded border border-surface-border">
                  {pkNoPrefix(pkNo)}
                </span>
              )}
            </h2>
            {order && (
              <Badge variant={statusVariant(order.status)} size="md">
                {statusLabel(order.status)}
              </Badge>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-ink-subtle hover:text-ink-strong text-xl"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-status-error-bg border border-status-error/40 text-status-error rounded p-3 text-sm">
              {error}
            </div>
          )}
          {!order ? (
            <div className="text-ink-muted text-sm">読み込み中…</div>
          ) : (
            <>
              {/* お客様情報 + 出荷情報 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Section title="👤 お客様情報">
                  <KV k="顧客名" v={order.destName ?? '—'} />
                  <KV
                    k="郵便番号"
                    v={<span className="font-mono">{order.destZip ?? '—'}</span>}
                  />
                  <KV k="住所" v={order.destAddr ?? '—'} />
                  <KV
                    k="のし"
                    v={
                      order.noshiName ? (
                        <span>
                          {order.noshiName}
                          <span className="ml-1 px-1.5 py-0.5 bg-pink-900 text-pink-100 text-[10px] rounded">
                            のし
                          </span>
                        </span>
                      ) : (
                        '—'
                      )
                    }
                  />
                </Section>
                <Section title="📦 出荷情報">
                  <KV
                    k="発送予定日"
                    v={`${new Date(order.shipDate).toLocaleDateString('ja-JP', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      weekday: 'short',
                    })}`}
                  />
                  <KV
                    k="運送会社"
                    v={
                      order.carrier ? (
                        <span>
                          🚚 {order.carrier.name}
                          {order.carrier.cool && (
                            <span className="ml-1 text-status-info">❄</span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <KV
                    k="納品書№"
                    v={
                      <span className="font-mono tabular-nums">
                        {order.invoiceNo ?? '— （梱包後採番）'}
                      </span>
                    }
                  />
                  <KV
                    k="QR印刷"
                    v={
                      order.qrPrintFlag ? (
                        <span className="text-pink-300">🖨 ON</span>
                      ) : (
                        <span className="text-ink-muted">○ OFF</span>
                      )
                    }
                  />
                  <KV
                    k="検品担当"
                    v={
                      order.inspSession?.staff
                        ? `${order.inspSession.staff.name} (${order.inspSession.staff.code})${order.inspSession.device ? ` / ${order.inspSession.device.name}` : ''}`
                        : '— 未着手'
                    }
                  />
                  <KV
                    k="着手時刻"
                    v={
                      order.inspSession
                        ? new Date(order.inspSession.startedAt).toLocaleTimeString('ja-JP')
                        : '—'
                    }
                  />
                </Section>
              </div>

              {/* 削除済みバナー */}
              {order.deletedAt && (
                <div className="bg-status-error-bg border border-status-error/40 rounded p-3 text-sm">
                  <div className="font-bold text-status-error">🗑 削除済み</div>
                  <div className="text-2xs text-red-300 mt-1">
                    {new Date(order.deletedAt).toLocaleString('ja-JP')} / {order.deletedBy}
                  </div>
                  <div className="text-2xs text-red-300">{order.deleteReason}</div>
                </div>
              )}
              {order.holdReason && (
                <div className="bg-status-warn-bg border border-status-warn/40 rounded p-3 text-sm">
                  <div className="font-bold text-status-warn">⏸ 保留</div>
                  <div className="text-2xs text-amber-300">{order.holdReason}</div>
                </div>
              )}

              {/* 明細 */}
              <Section title={`🥚 明細 (${order.items.length})`}>
                <div className="border border-surface-border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-base border-b border-surface-border">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-3xs uppercase text-ink-subtle">
                          構成商品コード
                        </th>
                        <th className="px-2 py-1.5 text-left text-3xs uppercase text-ink-subtle">
                          構成商品名
                        </th>
                        <th className="px-2 py-1.5 text-right text-3xs uppercase text-ink-subtle">
                          数量
                        </th>
                        <th className="px-2 py-1.5 text-left text-3xs uppercase text-ink-subtle">
                          状態
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((it) => (
                        <tr key={it.id} className="border-t border-surface-border">
                          <td className="px-2 py-1.5 font-mono text-2xs text-ink">
                            {it.productCode}
                          </td>
                          <td className="px-2 py-1.5">
                            {it.productName}
                            <div className="text-3xs text-ink-muted font-mono">
                              JAN: {it.product.jan ?? '—'}
                              {it.product.frozen && (
                                <span className="ml-1.5 text-status-info">❄ 冷凍</span>
                              )}
                              {it.product.special && (
                                <span className="ml-1.5 text-accent-amber">★ 特殊</span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{it.qty}</td>
                          <td className="px-2 py-1.5 text-2xs">
                            <ItemStatus item={it} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* 処理アクション 5 種 */}
              <Section title="⚙ 処理アクション">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
                  <ActionButton
                    icon="✏"
                    label="内容修正"
                    onClick={() => alert('内容修正は将来ブロックで実装予定です')}
                    disabled={busy || !!order.deletedAt}
                  />
                  <ActionButton
                    icon="🟣"
                    label="前倒し"
                    onClick={() => alert('前倒し処理は将来ブロックで実装予定です')}
                    disabled={busy || !!order.deletedAt}
                  />
                  <ActionButton
                    icon="🟠"
                    label="翌日繰越"
                    onClick={() => alert('翌日繰越は将来ブロックで実装予定です')}
                    disabled={busy || !!order.deletedAt}
                  />
                  <ActionButton
                    icon="🖨"
                    label="QR 再印刷"
                    onClick={onReprint}
                    disabled={busy || !!order.deletedAt}
                  />
                  <ActionButton
                    icon="❌"
                    label="キャンセル"
                    danger
                    onClick={() => setCancelDialog(true)}
                    disabled={busy || !!order.deletedAt || order.status === 'inspecting'}
                    title={
                      order.status === 'inspecting'
                        ? '検品中は削除できません（先に保留にしてから）'
                        : ''
                    }
                  />
                </div>
              </Section>

              {/* メッセージ送信 */}
              <Section title="💬 作業テーブル（この伝票の担当）へメッセージ送信">
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-[68px_1fr] gap-2 items-center">
                    <label className="text-2xs text-ink-subtle">宛先</label>
                    <select
                      value={msgTo}
                      onChange={(e) => setMsgTo(e.target.value as typeof msgTo)}
                      className="bg-surface-base border border-surface-border rounded px-2 py-1 text-xs text-ink"
                    >
                      <option value="table">
                        担当者（{order.inspSession?.staff?.name ?? '—'}）
                      </option>
                      <option value="group">担当グループ全員</option>
                      <option value="tablet">タブレット全体</option>
                      <option value="all">全員</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-[68px_1fr] gap-2">
                    <label className="text-2xs text-ink-subtle pt-1">テンプレ</label>
                    <div className="flex flex-wrap gap-1">
                      {MSG_TEMPLATES.map((t) => (
                        <button
                          key={t.label}
                          onClick={() => setMsgBody(t.text)}
                          className="text-2xs px-2 py-0.5 rounded border border-surface-border bg-surface-base text-ink-subtle hover:text-ink hover:border-accent-amber"
                          type="button"
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-[68px_1fr] gap-2 items-start">
                    <label className="text-2xs text-ink-subtle pt-1">本文</label>
                    <textarea
                      value={msgBody}
                      onChange={(e) => setMsgBody(e.target.value)}
                      rows={2}
                      placeholder="作業テーブル端末にポップアップ表示されます"
                      className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs text-ink resize-none"
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <label className="text-2xs text-ink flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={msgAck}
                        onChange={(e) => setMsgAck(e.target.checked)}
                      />
                      「了解」タップを必須にする
                    </label>
                    <div className="flex items-center gap-2">
                      {msgFlash && (
                        <span className="text-2xs text-status-ok">{msgFlash}</span>
                      )}
                      <button
                        onClick={onSendMessage}
                        disabled={msgBusy || !msgBody.trim()}
                        className="px-3 py-1 rounded bg-brand-primary text-white text-xs font-bold hover:bg-blue-600 disabled:opacity-50"
                      >
                        {msgBusy ? '送信中…' : '💬 送信'}
                      </button>
                    </div>
                  </div>
                </div>
              </Section>

              {/* タイムライン */}
              <Section title={`📜 タイムライン (${timeline.length})`}>
                {timeline.length === 0 ? (
                  <p className="text-2xs text-ink-muted">記録はありません</p>
                ) : (
                  <ul className="space-y-1 text-2xs">
                    {timeline.map((ev, i) => (
                      <li
                        key={`${ev.kind}-${ev.at}-${i}`}
                        className="flex gap-2 border-l-2 border-surface-border pl-2"
                      >
                        <span className="font-mono text-ink-muted shrink-0 w-12">
                          {formatTime(ev.at)}
                        </span>
                        <span className="shrink-0 w-4">{ev.icon}</span>
                        <span className="flex-1 text-ink">
                          {ev.message}
                          {ev.actor && (
                            <span className="text-ink-muted ml-1">／ {ev.actor}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={cancelDialog}
        title="伝票をキャンセル（論理削除）しますか？"
        body={
          order ? (
            <div>
              <div>
                PkNo: <span className="font-mono text-accent-amber">{order.pkNo}</span>
              </div>
              <div className="text-status-warn mt-1 text-2xs">
                ⚠ 論理削除のため復活可能ですが、検品中の伝票は削除できません。
              </div>
            </div>
          ) : null
        }
        promptLabel="キャンセル理由（必須）"
        promptPlaceholder="例: お客様都合によるキャンセル"
        confirmLabel="❌ キャンセル実行"
        variant="danger"
        onConfirm={onCancel}
        onCancel={() => setCancelDialog(false)}
      />
    </div>
  );
}

// ──────────────────────────────────────────────
// 部品
// ──────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1.5">
        {title}
      </h5>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-1.5 text-2xs items-baseline">
      <div className="text-ink-subtle">{k}</div>
      <div className="text-ink-strong">{v}</div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  danger,
  title,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  const cls = danger
    ? 'border-status-error/60 bg-red-950/30 text-red-200 hover:bg-red-900'
    : 'border-surface-border bg-surface-base text-ink hover:bg-surface-raised hover:border-accent-amber';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2 py-1.5 rounded border text-xs ${cls} disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1`}
    >
      <span>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function ItemStatus({ item }: { item: OrderItem }) {
  if (item.forceOk) {
    return (
      <span className="inline-flex items-center gap-1">
        {item.forceReasonCode && (
          <span
            className={`px-1 rounded text-[10px] font-bold ${reasonBadgeClass(item.forceReasonCode)}`}
          >
            {item.forceReasonCode}
          </span>
        )}
        <span className="text-status-error">⚠ 強制OK</span>
        {item.forceApprovalStatus === 'approved' && (
          <span className="text-status-ok ml-1">✓ 承認済</span>
        )}
        {item.forceApprovalStatus === 'rejected' && (
          <span className="text-status-error ml-1">✗ 却下</span>
        )}
      </span>
    );
  }
  if (item.scannedQty >= item.qty) {
    return <span className="text-status-ok">✓ 検品済</span>;
  }
  if (item.scannedQty > 0) {
    return (
      <span className="text-status-warn">
        ⏳ 進行中 ({item.scannedQty}/{item.qty})
      </span>
    );
  }
  return <span className="text-ink-muted">○ 未検品</span>;
}

// ──────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────

function pkNoPrefix(pkNo: string): string | null {
  // "STC-..." → "ST", "FRZ-..." → "FR" など先頭2文字
  // ただし数字始まりや短すぎる場合は表示しない
  const m = pkNo.match(/^([A-Z]{2,4})/);
  return m ? m[1] : null;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return '⏸ 未着手';
    case 'inspecting':
      return '🟦 検品中';
    case 'packed':
      return '✅ 完了';
    case 'held':
      return '⚠ 保留';
    default:
      return status;
  }
}

function statusVariant(status: string): 'wait' | 'working' | 'done' | 'warn' | 'neutral' {
  switch (status) {
    case 'pending':
      return 'wait';
    case 'inspecting':
      return 'working';
    case 'packed':
      return 'done';
    case 'held':
      return 'warn';
    default:
      return 'neutral';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOf = new Date(d);
  dayOf.setHours(0, 0, 0, 0);
  if (dayOf.getTime() !== today.getTime()) {
    return d.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
