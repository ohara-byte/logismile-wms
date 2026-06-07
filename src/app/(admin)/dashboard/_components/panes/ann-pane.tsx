'use client';

/**
 * 📢 連絡タブ（発信／着信 サブタブ）
 *
 * モック準拠（管理用PCモック_v0.22.html L2604-2697 + .ann-* スタイル L494-）
 *
 * サブタブ:
 *   📤 発信 (announce) … 管理 PC → 現場（タブレット/ハンディ）
 *     - 宛先（all/tablet/handy/group/staff）
 *     - 緊急度（high/mid/low → priority 80/50/20）
 *     - 件名 / 本文 / 「了解」タップ必須チェック
 *     - 本日の発信履歴
 *   📥 着信 (inbox) … 現場 → 管理 PC
 *     - 分類フィルタ（すべて/未読/のし/商品/入力/WEB）
 *     - ☑ で既読化 → BadgeContext 即時 refresh
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBadges } from '@/components/admin/badge-context';

/** ブラウザ（JST）のローカル暦日を YYYY-MM-DD で返す。
 *  toISOString は UTC のため JST 早朝に前日になる不具合があった（2026-06-06 修正）。 */
const todayLocalYmd = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Notice {
  id: number;
  date: string;
  kind: 'announce' | 'inbox';
  title: string;
  body: string | null;
  targetType: string;
  targetId: string | null;
  category: string | null;
  ackRequired: boolean;
  senderCode: string | null;
  priority: number;
  active: boolean;
  readAt: string | null;
  readBy: string | null;
  createdAt: string;
}

type SubTab = 'send' | 'recv';
type Priority = 'high' | 'mid' | 'low';
type TargetType = 'all' | 'tablet' | 'handy' | 'group' | 'staff';
type IncFilter = 'all' | 'unread' | 'noshi' | 'product' | 'input' | 'web';

const PRIORITY_VALUE: Record<Priority, number> = { high: 90, mid: 50, low: 20 };
const PRIORITY_LABEL: Record<Priority, string> = {
  high: '🚨 緊急',
  mid: '● 通常',
  low: 'ℹ 情報',
};

const TARGET_LABEL: Record<TargetType, string> = {
  all: '👥 全員',
  tablet: '📱 タブレット',
  handy: '🔦 ハンディ',
  group: '🔶 グループ指定',
  staff: '👤 担当者指定',
};

const INC_FILTER_LABEL: Record<IncFilter, string> = {
  all: 'すべて',
  unread: '🔴 未読',
  noshi: '🎁 のし',
  product: '📦 商品',
  input: '✏ 入力',
  web: '🌐 WEB',
};

export function AnnPane() {
  const [sub, setSub] = useState<SubTab>('recv');
  const [announceItems, setAnnounceItems] = useState<Notice[]>([]);
  const [inboxItems, setInboxItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const { refresh: refreshBadges } = useBadges();

  const reload = useCallback(async () => {
    try {
      const today = todayLocalYmd();
      const [aRes, iRes] = await Promise.all([
        fetch(`/api/notices?kind=announce&date=${today}`),
        fetch('/api/notices?kind=inbox'),
      ]);
      const aJson = await aRes.json();
      const iJson = await iRes.json();
      setAnnounceItems(aJson.data?.items ?? []);
      setInboxItems(iJson.data?.items ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [reload]);

  const inboxUnreadCount = useMemo(
    () => inboxItems.filter((i) => !i.readAt).length,
    [inboxItems],
  );

  return (
    <div className="p-3">
      {/* サブタブ */}
      <div className="flex border-b border-surface-border mb-3">
        <SubTabButton
          label={`📤 発信`}
          count={announceItems.length}
          active={sub === 'send'}
          onClick={() => setSub('send')}
        />
        <SubTabButton
          label={`📥 着信`}
          count={inboxUnreadCount}
          highlight={inboxUnreadCount > 0}
          active={sub === 'recv'}
          onClick={() => setSub('recv')}
        />
      </div>

      {loading ? (
        <div className="text-2xs text-ink-muted">読み込み中…</div>
      ) : sub === 'send' ? (
        <AnnSendPanel items={announceItems} onSent={reload} />
      ) : (
        <AnnRecvPanel
          items={inboxItems}
          onMarkRead={async (id) => {
            // 楽観更新
            setInboxItems((prev) =>
              prev.map((it) =>
                it.id === id ? { ...it, readAt: new Date().toISOString() } : it,
              ),
            );
            try {
              await fetch(`/api/notices/${id}/read`, { method: 'PUT' });
              refreshBadges();
            } catch {
              reload();
            }
          }}
        />
      )}
    </div>
  );
}

function SubTabButton({
  label,
  count,
  active,
  highlight,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-2 py-1.5 text-xs font-bold border-b-2 transition-colors ${
        active
          ? 'border-accent-amber text-accent-amber'
          : 'border-transparent text-ink-subtle hover:text-ink-strong'
      }`}
    >
      {label}
      <span
        className={`ml-1.5 inline-block min-w-[18px] px-1 rounded text-[10px] ${
          highlight ? 'bg-status-error text-white' : 'bg-surface-base text-ink-muted'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// ──────────────────────────────────────────────
// 発信パネル
// ──────────────────────────────────────────────

function AnnSendPanel({
  items,
  onSent,
}: {
  items: Notice[];
  onSent: () => void;
}) {
  const [target, setTarget] = useState<TargetType>('all');
  const [targetId, setTargetId] = useState('');
  const [priority, setPriority] = useState<Priority>('mid');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ackRequired, setAckRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 宛先候補（2026-06-06）: グループ→グループマスタ / 担当者→当日出勤者
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [staffToday, setStaffToday] = useState<{ code: string; name: string }[]>([]);
  const [candLoading, setCandLoading] = useState(false);

  const needsTargetId = target === 'group' || target === 'staff';

  // 宛先を group/staff にしたとき候補を取得（staff は当日出勤者のみ）
  useEffect(() => {
    let cancelled = false;
    async function loadCandidates() {
      if (target === 'group') {
        if (groups.length > 0) return;
        setCandLoading(true);
        try {
          const r = await fetch('/api/master/groups');
          const j = await r.json();
          if (!cancelled) {
            setGroups(
              (j.data?.items ?? []).map((g: { id: string; name: string }) => ({
                id: g.id,
                name: g.name,
              })),
            );
          }
        } catch {
          /* ignore */
        } finally {
          if (!cancelled) setCandLoading(false);
        }
      } else if (target === 'staff') {
        setCandLoading(true);
        try {
          const r = await fetch('/api/shifts/today'); // 既定=本日(JST)
          const j = await r.json();
          const items: Array<{
            staff: { code: string; name: string } | null;
            pattern: { isOff: boolean } | null;
          }> = j.data?.items ?? [];
          const working = items
            .filter((s) => s.staff && !s.pattern?.isOff)
            .map((s) => ({ code: s.staff!.code, name: s.staff!.name }));
          if (!cancelled) setStaffToday(working);
        } catch {
          /* ignore */
        } finally {
          if (!cancelled) setCandLoading(false);
        }
      }
    }
    loadCandidates();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const canSend = title.trim().length > 0 && (!needsTargetId || targetId.trim().length > 0) && !busy;

  async function handleSend() {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'announce',
          date: todayLocalYmd(),
          targetType: target,
          targetId: needsTargetId ? targetId.trim() : null,
          title: title.trim(),
          body: body.trim() || null,
          priority: PRIORITY_VALUE[priority],
          ackRequired,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${r.status}`);
      }
      // フォームリセット
      setTitle('');
      setBody('');
      setTargetId('');
      setPriority('mid');
      onSent();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* 発信フォーム */}
      <div className="bg-surface-base border border-surface-border rounded-lg p-3">
        <h4 className="text-xs font-bold text-accent-amber mb-2">📢 連絡事項を発信</h4>

        <FormRow label="宛先">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(TARGET_LABEL) as TargetType[]).map((t) => (
              <Chip
                key={t}
                active={target === t}
                onClick={() => {
                  setTarget(t);
                  setTargetId(''); // 宛先タイプ切替時は選択をリセット
                }}
              >
                {TARGET_LABEL[t]}
              </Chip>
            ))}
          </div>
        </FormRow>

        {needsTargetId && (
          <FormRow label={target === 'group' ? 'グループ' : '担当者（当日出勤）'}>
            {candLoading ? (
              <span className="text-2xs text-ink-muted">候補を読み込み中…</span>
            ) : target === 'group' ? (
              groups.length === 0 ? (
                <span className="text-2xs text-ink-muted">グループがありません</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {groups.map((g) => (
                    <Chip key={g.id} active={targetId === g.id} onClick={() => setTargetId(g.id)}>
                      {g.name}
                    </Chip>
                  ))}
                </div>
              )
            ) : staffToday.length === 0 ? (
              <span className="text-2xs text-ink-muted">
                本日の出勤者がいません（シフト未登録の可能性）
              </span>
            ) : (
              <div className="flex flex-wrap gap-1 max-h-32 overflow-auto">
                {staffToday.map((s) => (
                  <Chip key={s.code} active={targetId === s.code} onClick={() => setTargetId(s.code)}>
                    {s.name}
                  </Chip>
                ))}
              </div>
            )}
          </FormRow>
        )}

        <FormRow label="緊急度">
          <div className="flex gap-1">
            {(['mid', 'high', 'low'] as Priority[]).map((p) => (
              <Chip
                key={p}
                active={priority === p}
                variant={p}
                onClick={() => setPriority(p)}
              >
                {PRIORITY_LABEL[p]}
              </Chip>
            ))}
          </div>
        </FormRow>

        <FormRow label="件名" required>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：本日17:30 ヤマト便 集荷前倒し"
            maxLength={100}
            className="w-full bg-surface-panel border border-surface-border rounded px-2 py-1 text-xs text-ink"
          />
        </FormRow>

        <FormRow label="本文">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="現場端末（タブレット/ハンディ）のポップアップに表示されます"
            rows={3}
            className="w-full bg-surface-panel border border-surface-border rounded px-2 py-1 text-xs text-ink resize-none"
          />
        </FormRow>

        <FormRow label="確認要求">
          <label className="text-2xs text-ink flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={ackRequired}
              onChange={(e) => setAckRequired(e.target.checked)}
            />
            「了解」タップを必須にする
          </label>
        </FormRow>

        {error && (
          <div className="text-2xs bg-status-error-bg text-status-error border border-status-error rounded p-2 my-2">
            {error}
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={!canSend}
          className="w-full mt-1 px-3 py-2 rounded bg-brand-primary text-white text-sm font-bold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? '送信中…' : '📢 発信する'}
        </button>
      </div>

      {/* 発信履歴 */}
      <div>
        <h4 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1.5">
          本日の発信履歴 ({items.length})
        </h4>
        {items.length === 0 ? (
          <p className="text-2xs text-ink-muted">本日の発信はまだありません</p>
        ) : (
          items.map((n) => <AnnounceCard key={n.id} notice={n} />)
        )}
      </div>
    </div>
  );
}

function AnnounceCard({ notice }: { notice: Notice }) {
  const prio: Priority =
    notice.priority >= 80 ? 'high' : notice.priority < 40 ? 'low' : 'mid';
  const borderClass =
    prio === 'high'
      ? 'border-l-status-error'
      : prio === 'low'
        ? 'border-l-status-info'
        : 'border-l-status-warn';
  const targetLabel =
    notice.targetType === 'all'
      ? '全員'
      : `${notice.targetType}${notice.targetId ? `: ${notice.targetId}` : ''}`;

  return (
    <div
      className={`bg-surface-base border-l-2 ${borderClass} rounded mb-1 px-2 py-1.5`}
    >
      <div className="flex justify-between items-baseline mb-0.5 text-[10px] text-ink-muted">
        <span className="font-bold text-ink">
          {PRIORITY_LABEL[prio]} ／ {targetLabel}
        </span>
        <span className="font-mono">{formatTime(notice.createdAt)}</span>
      </div>
      <div className="text-xs text-ink-strong leading-snug">{notice.title}</div>
      {notice.body && (
        <div className="text-2xs text-ink-subtle mt-0.5 leading-snug">{notice.body}</div>
      )}
      {notice.ackRequired && (
        <div className="text-[10px] text-accent-amber mt-0.5">☑ 了解タップ必須</div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// 着信パネル
// ──────────────────────────────────────────────

function AnnRecvPanel({
  items,
  onMarkRead,
}: {
  items: Notice[];
  onMarkRead: (id: number) => Promise<void>;
}) {
  const [filter, setFilter] = useState<IncFilter>('all');

  const counts: Record<IncFilter, number> = {
    all: items.length,
    unread: items.filter((i) => !i.readAt).length,
    noshi: items.filter((i) => i.category === 'noshi').length,
    product: items.filter((i) => i.category === 'product').length,
    input: items.filter((i) => i.category === 'input').length,
    web: items.filter((i) => i.category === 'web').length,
  };

  const filtered = items.filter((it) => {
    if (filter === 'all') return true;
    if (filter === 'unread') return !it.readAt;
    return it.category === filter;
  });

  return (
    <div>
      <div className="text-[10px] text-ink-muted mb-2">
        📥 タブレット／ハンディからの<b className="text-accent-amber">本部連絡</b>。分類でフィルタ・☑ で既読化。
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        {(Object.keys(INC_FILTER_LABEL) as IncFilter[]).map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {INC_FILTER_LABEL[f]}
            <span className="ml-1 opacity-70 font-normal">{counts[f]}</span>
          </Chip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-6">
          <div className="text-2xl mb-1 opacity-50">📭</div>
          <p className="text-2xs text-ink-muted">
            {filter === 'all' ? '着信はありません' : '該当する着信はありません'}
          </p>
        </div>
      ) : (
        filtered.map((n) => (
          <InboxCard key={n.id} notice={n} onMarkRead={() => onMarkRead(n.id)} />
        ))
      )}
    </div>
  );
}

function InboxCard({
  notice,
  onMarkRead,
}: {
  notice: Notice;
  onMarkRead: () => void;
}) {
  const isUnread = !notice.readAt;
  const catIcon = categoryIcon(notice.category);

  return (
    <div
      className={`rounded mb-1.5 px-2.5 py-1.5 border ${
        isUnread
          ? 'bg-red-950/30 border-status-error/40'
          : 'bg-surface-base border-surface-border opacity-75'
      }`}
    >
      <div className="flex justify-between items-baseline mb-0.5 text-[10px] text-ink-muted">
        <span>
          {catIcon} {notice.senderCode ?? '匿名'}
        </span>
        <span className="font-mono">{formatTime(notice.createdAt)}</span>
      </div>
      <div className="text-xs text-ink-strong leading-snug">{notice.title}</div>
      {notice.body && (
        <div className="text-2xs text-ink-subtle mt-0.5 leading-snug">{notice.body}</div>
      )}
      <div className="flex justify-end mt-1">
        {isUnread ? (
          <button
            onClick={onMarkRead}
            className="text-[10px] px-2 py-0.5 rounded border border-status-info bg-blue-900 text-white hover:bg-blue-700"
          >
            ☑ 既読化
          </button>
        ) : (
          <span className="text-[10px] text-ink-muted">
            {notice.readBy ? `${notice.readBy} が既読` : '既読'}
          </span>
        )}
      </div>
    </div>
  );
}

function categoryIcon(cat: string | null): string {
  switch (cat) {
    case 'noshi':
      return '🎁';
    case 'product':
      return '📦';
    case 'input':
      return '✏';
    case 'web':
      return '🌐';
    default:
      return '📥';
  }
}

// ──────────────────────────────────────────────
// 共通フォーム部品
// ──────────────────────────────────────────────

function FormRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[68px_1fr] gap-2 mb-2 items-start">
      <label className="text-[10px] text-ink-subtle pt-1">
        {label}
        {required && <span className="text-status-error ml-0.5">*</span>}
      </label>
      <div>{children}</div>
    </div>
  );
}

function Chip({
  active,
  variant,
  onClick,
  children,
}: {
  active?: boolean;
  variant?: Priority;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base =
    'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] cursor-pointer border transition-colors whitespace-nowrap';
  const offClass = 'bg-surface-panel border-surface-border text-ink-subtle hover:border-accent-amber/50';
  const onClass =
    variant === 'high'
      ? 'bg-red-900 border-status-error text-red-100 font-bold'
      : variant === 'low'
        ? 'bg-blue-900 border-status-info text-blue-100 font-bold'
        : 'bg-amber-900 border-accent-amber text-amber-100 font-bold';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? onClass : offClass}`}
    >
      {children}
    </button>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
