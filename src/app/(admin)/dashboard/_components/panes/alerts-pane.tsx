'use client';

/**
 * 🔔 アラートタブ（通知センター）
 *
 * モック準拠（管理用PCモック_v0.22.html L2467-2525 + .alert-item スタイル L443-461）
 *
 * 仕様:
 *  - GET /api/alerts?resolved=false で未解決アラートを取得
 *  - severity (error/warn/info/ok) で左ボーダー色を切替
 *  - 「既読」ボタン → PUT /api/alerts/:id/resolve → BadgeContext を即時 refresh
 *  - refCode の値に応じて関連タブへの導線ボタンを出す
 *      'force'  → ⚠強制OK 承認画面へ
 *      'carr'   → 🚚運送会社タブへ
 *      'match'  → 📋未検品照合タブへ
 *  - 5 秒ポーリングで一覧をリフレッシュ（A-19 で SSE push に置換予定）
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBadges } from '@/components/admin/badge-context';
import type { TabId } from '../tabs-config';

interface Alert {
  id: number;
  type: string;
  severity: string;
  title: string;
  body: string | null;
  refCode: string | null;
  resolved: boolean;
  createdAt: string;
}

interface RouteAction {
  tabId: TabId;
  label: string;
}

const ROUTE_MAP: Record<string, RouteAction> = {
  force: { tabId: 'force', label: '承認画面へ' },
  carr: { tabId: 'carr', label: '運送タブへ' },
  match: { tabId: 'match', label: '未検品照合へ' },
  ann: { tabId: 'ann', label: '連絡タブへ' },
  link: { tabId: 'link', label: '基幹連携タブへ' },
};

export function AlertsPane() {
  const [items, setItems] = useState<Alert[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  const { refresh: refreshBadges } = useBadges();

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/alerts?resolved=false');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setItems(j.data?.items ?? []);
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

  async function onResolve(id: number) {
    setBusyId(id);
    // 楽観更新
    setItems((prev) => (prev ?? []).filter((a) => a.id !== id));
    try {
      const r = await fetch(`/api/alerts/${id}/resolve`, { method: 'PUT' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // SSE が拾うのを待たずにバッジを即時更新
      refreshBadges();
    } catch (e) {
      // 失敗したら一覧を再取得して整合させる
      setError(String(e));
      reload();
    } finally {
      setBusyId(null);
    }
  }

  function onJumpTab(tabId: TabId) {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', tabId);
    router.replace(`/dashboard?${sp.toString()}`, { scroll: false });
  }

  if (items === null) {
    return (
      <div className="p-3 text-xs text-ink-muted flex items-center gap-2">
        <span className="w-2 h-2 bg-accent-amber rounded-full animate-pulse" />
        読み込み中…
      </div>
    );
  }

  return (
    <div className="p-3">
      {error && (
        <div className="mb-2 p-2 text-xs bg-status-error-bg text-status-error border border-status-error rounded">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-4xl mb-2 opacity-50">✅</div>
          <p className="text-sm text-ink-muted">未解決のアラートはありません</p>
        </div>
      ) : (
        items.map((a) => {
          const route = a.refCode ? ROUTE_MAP[a.refCode] : undefined;
          const busy = busyId === a.id;
          return (
            <AlertCard
              key={a.id}
              alert={a}
              route={route}
              busy={busy}
              onResolve={() => onResolve(a.id)}
              onJump={route ? () => onJumpTab(route.tabId) : undefined}
            />
          );
        })
      )}

      <div className="mt-2 text-xs text-ink-muted text-right">
        {items.length} 件 / 5 秒ごとに自動更新
      </div>
    </div>
  );
}

function AlertCard({
  alert,
  route,
  busy,
  onResolve,
  onJump,
}: {
  alert: Alert;
  route?: RouteAction;
  busy: boolean;
  onResolve: () => void;
  onJump?: () => void;
}) {
  const sevClass = severityClass(alert.severity);
  const icon = severityIcon(alert.severity);

  // Sprint Y-1 UI: フォント・ボタン拡大（モック L443-461 準拠 〜 +1 段階）
  return (
    <div
      className={`bg-surface-base rounded mb-2 px-3 py-2.5 border-l-[4px] ${sevClass}`}
    >
      <div className="flex justify-between items-baseline mb-1.5 gap-2">
        <div className="text-sm font-bold text-ink-strong leading-tight flex-1 min-w-0">
          <span className="mr-1.5">{icon}</span>
          {alert.title}
        </div>
        <div className="text-xs font-mono text-ink-muted shrink-0 tabular-nums">
          {formatTime(alert.createdAt)}
        </div>
      </div>
      {alert.body && (
        <div className="text-xs text-ink leading-relaxed mb-2 whitespace-pre-wrap">
          {alert.body}
        </div>
      )}
      <div className="flex gap-2">
        {onJump && (
          <button
            onClick={onJump}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-brand-primary bg-blue-900 text-white hover:bg-blue-700 font-bold disabled:opacity-50"
          >
            {route?.label ?? '関連画面へ'}
          </button>
        )}
        <button
          onClick={onResolve}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded border border-surface-border bg-surface-panel text-ink hover:bg-surface-raised hover:border-accent-amber font-bold disabled:opacity-50"
        >
          {busy ? '…' : '既読'}
        </button>
      </div>
    </div>
  );
}

function severityClass(sev: string): string {
  switch (sev) {
    case 'error':
      return 'border-status-error';
    case 'warn':
      return 'border-status-warn';
    case 'info':
      return 'border-status-info';
    case 'ok':
    case 'success':
      return 'border-status-ok';
    default:
      return 'border-status-error';
  }
}

function severityIcon(sev: string): string {
  switch (sev) {
    case 'error':
      return '🚨';
    case 'warn':
      return '⚠';
    case 'info':
      return 'ℹ';
    case 'ok':
    case 'success':
      return '✅';
    default:
      return '🚨';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
