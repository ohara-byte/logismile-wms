'use client';

/**
 * 連絡事項モーダル（タブレット起動時 / ハンディ起動時 共用）
 *
 * Sprint U-5: モック準拠（タブレット検品モック_v0.18.html L1434-1448 / L713-745）。
 *
 * - 起動時に `/api/notices?unread=true` で未読の announce + inbox をまとめて取得
 * - 一覧表示。「📢 全体連絡 (announce)」と「💌 個別メッセージ (inbox)」を 2 セクションに分離
 * - 各カードに ☑ チェック → クリックで `/api/notices/[id]/read` を叩いて既読化
 * - 既読化された項目は即座にビューから消える（hide-on-check）
 * - 全件確認したら「▶ 全て確認して作業開始」ボタンが有効化
 * - 「あとで確認」ですぐ閉じる
 */

import { useEffect, useMemo, useState } from 'react';

export interface Notice {
  id: number;
  kind: 'announce' | 'inbox';
  title: string;
  body: string | null;
  priority: number;
  category: string | null;
  senderCode: string | null;
  senderName?: string | null;
  date: string;
  createdAt: string;
}

interface Props {
  /** 表示する場面の文脈。"handy-launch" は KEYENCE BT-A500 用に文字を小さめに。 */
  variant: 'handy-launch' | 'tablet-launch';
  onClose: () => void;
}

export function NoticesModal({ variant, onClose }: Props) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  /** チェック済 ID セット — クリックでマーク、確認時に commit。 */
  const [checkedSet, setCheckedSet] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  // 未読のみ初回取得
  useEffect(() => {
    fetch('/api/notices?unread=true')
      .then((r) => r.json())
      .then((j) => setNotices(j.data?.items ?? []))
      .catch(() => setNotices([]));
  }, []);

  // モック L2701-2710 準拠: Enter キーで未チェックを順次☑、全チェック後は作業開始
  useEffect(() => {
    if (!notices) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      const t = e.target as Element | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          (t as HTMLElement).isContentEditable)
      )
        return;
      e.preventDefault();
      const list = notices ?? [];
      const next = list.find((n) => !checkedSet.has(n.id));
      if (next) {
        setCheckedSet((prev) => new Set(prev).add(next.id));
      } else {
        // 全件確認済み → 作業開始
        void commitAndStart();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notices, checkedSet]);

  const announces = useMemo(
    () => (notices ?? []).filter((n) => n.kind === 'announce'),
    [notices],
  );
  const inbox = useMemo(
    () => (notices ?? []).filter((n) => n.kind === 'inbox'),
    [notices],
  );
  const total = notices?.length ?? 0;
  const allChecked = total > 0 && checkedSet.size >= total;

  /** カードクリック: 視覚的にチェック状態をトグル（即削除しない） */
  function toggleCheck(id: number) {
    setCheckedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 「全てチェック」ボタン */
  function checkAllVisible() {
    setCheckedSet(new Set((notices ?? []).map((n) => n.id)));
  }

  /** 「▶ 確認して作業開始」: チェック済を一括既読 API、その後 onClose */
  async function commitAndStart() {
    if (busy) return;
    if (!allChecked) return;
    setBusy(true);
    try {
      await Promise.all(
        Array.from(checkedSet).map((id) =>
          fetch(`/api/notices/${id}/read`, { method: 'PUT' }).catch(() => null),
        ),
      );
    } finally {
      setBusy(false);
      onClose();
    }
  }

  // ローディング
  if (!notices) {
    return (
      <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div
          style={{
            background: '#1e293b',
            borderRadius: 14,
            padding: 24,
            color: '#f1f5f9',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              background: '#fbbf24',
              borderRadius: '50%',
            }}
            className="animate-pulse"
          />
          📢 連絡事項を読み込み中…
        </div>
      </div>
    );
  }

  // 未読が無ければ何も表示せず即閉じる
  if (notices.length === 0) {
    onClose();
    return null;
  }

  const wide = variant === 'tablet-launch';

  return (
    <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div
        style={{
          background: '#1e293b',
          borderRadius: 14,
          padding: 24,
          width: wide ? 720 : 480,
          maxWidth: '94vw',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          color: '#f1f5f9',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h2
          style={{
            color: '#fbbf24',
            fontSize: 22,
            marginBottom: 4,
            fontWeight: 'bold',
          }}
        >
          📢 本日の連絡事項
        </h2>
        <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
          管理用 PC から登録された連絡事項です。一件ずつクリックして☑ をつけ、最後に
          <b style={{ color: '#fed7aa' }}>「確認して作業開始」</b>を押すと既読化されます。
        </p>

        {/* プログレス */}
        <NoticeProgress checked={checkedSet.size} total={total} />

        {/* 一覧 */}
        <div
          style={{
            background: '#0f172a',
            borderRadius: 10,
            padding: 10,
            marginBottom: 18,
            maxHeight: 420,
            overflowY: 'auto',
          }}
        >
          {/* announce セクション */}
          {announces.length > 0 && (
            <NoticeSection
              title="📢 全体連絡"
              items={announces}
              checkedSet={checkedSet}
              onToggle={toggleCheck}
            />
          )}

          {/* inbox セクション */}
          {inbox.length > 0 && (
            <NoticeSection
              title="💌 個別メッセージ"
              items={inbox}
              checkedSet={checkedSet}
              onToggle={toggleCheck}
              accent="#a78bfa"
            />
          )}
        </div>

        {/* アクション */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              height: 44,
              padding: '0 16px',
              borderRadius: 8,
              background: '#475569',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 13,
            }}
          >
            あとで確認
          </button>
          {!allChecked && (
            <button
              onClick={checkAllVisible}
              disabled={busy}
              style={{
                height: 44,
                padding: '0 16px',
                borderRadius: 8,
                background: '#1e40af',
                color: '#fff',
                fontWeight: 'bold',
                fontSize: 13,
              }}
            >
              ☑ 全て選択
            </button>
          )}
          <button
            onClick={commitAndStart}
            disabled={!allChecked || busy}
            style={{
              height: 44,
              padding: '0 18px',
              borderRadius: 8,
              background: allChecked ? '#059669' : '#1e293b',
              color: allChecked ? '#fff' : '#475569',
              fontWeight: 'bold',
              fontSize: 13,
              opacity: allChecked ? 1 : 0.5,
              cursor: allChecked ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>▶</span>
            {busy ? '確認中…' : '確認して作業開始'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NoticeProgress({ checked, total }: { checked: number; total: number }) {
  const pct = total > 0 ? Math.round((checked / total) * 100) : 100;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 10,
        fontSize: 12,
        color: '#cbd5e1',
      }}
    >
      <span>確認状況</span>
      <div
        style={{
          flex: 1,
          height: 6,
          background: '#0f172a',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: '#10b981',
            transition: 'width 0.2s',
          }}
        />
      </div>
      <span>
        <b>{checked}</b> / <b>{total}</b> 件
      </span>
    </div>
  );
}

function NoticeSection({
  title,
  items,
  checkedSet,
  onToggle,
  accent,
}: {
  title: string;
  items: Notice[];
  checkedSet: Set<number>;
  onToggle: (id: number) => void;
  accent?: string;
}) {
  const checked = items.filter((n) => checkedSet.has(n.id)).length;
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          fontSize: 11,
          color: accent ?? '#fbbf24',
          fontWeight: 'bold',
          letterSpacing: 1,
          marginBottom: 4,
          paddingLeft: 4,
        }}
      >
        {title}（{checked} / {items.length} 件確認）
      </div>
      {items.map((n) => (
        <NoticeItem
          key={n.id}
          notice={n}
          checked={checkedSet.has(n.id)}
          onToggle={() => onToggle(n.id)}
        />
      ))}
    </div>
  );
}

function NoticeItem({
  notice,
  checked,
  onToggle,
}: {
  notice: Notice;
  checked: boolean;
  onToggle: () => void;
}) {
  const isHigh = notice.priority >= 70;
  const borderColor = checked
    ? '#10b981'
    : isHigh
      ? '#dc2626'
      : notice.kind === 'inbox'
        ? '#a78bfa'
        : '#64748b';
  const datetime = new Date(notice.createdAt).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: 'grid',
        gridTemplateColumns: '36px 1fr',
        gap: 12,
        padding: 14,
        background: checked ? '#064e3b' : '#1e293b',
        borderRadius: 8,
        marginBottom: 8,
        borderLeft: `4px solid ${borderColor}`,
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'all 0.15s',
        color: '#f1f5f9',
      }}
      className="hover:brightness-110"
    >
      <div
        style={{
          width: 26,
          height: 26,
          border: `2px solid ${checked ? '#10b981' : '#64748b'}`,
          borderRadius: 5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          fontWeight: 'bold',
          color: checked ? '#fff' : 'transparent',
          background: checked ? '#10b981' : 'transparent',
          marginTop: 2,
        }}
      >
        ✓
      </div>
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
            fontSize: 11,
            color: '#94a3b8',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              fontWeight: 'bold',
              background: isHigh ? '#7f1d1d' : '#334155',
              color: isHigh ? '#fecaca' : '#cbd5e1',
            }}
          >
            {isHigh ? '重要' : notice.kind === 'inbox' ? '受信' : '連絡'}
          </span>
          {(notice.senderName ?? notice.senderCode) && (
            <span>{notice.senderName ?? notice.senderCode}</span>
          )}
          <span>{datetime}</span>
          {notice.category && (
            <span style={{ color: '#64748b', fontFamily: 'Consolas, monospace' }}>
              {notice.category}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 'bold',
            marginBottom: 2,
            color: checked ? '#a7f3d0' : '#f1f5f9',
          }}
        >
          {notice.title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: checked ? '#86efac' : '#cbd5e1',
            lineHeight: 1.55,
          }}
        >
          {notice.body ?? ''}
        </div>
      </div>
    </button>
  );
}
