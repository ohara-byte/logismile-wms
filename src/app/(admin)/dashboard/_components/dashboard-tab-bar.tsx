'use client';

/**
 * 管理PC ダッシュボード右ペイン タブバー
 *
 * モック準拠（管理用PCモック_v0.22.html L2452-2463 + .tab-bar/.tab スタイル L422-441）。
 *
 * - 10 タブを横一列に等分配置
 * - active タブは下に黄色アンダーライン、上部背景が反転
 * - 各タブにバッジ（赤=error / 橙=warn）
 * - ?tab=<id> で URL 同期
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { TABS, DEFAULT_TAB, isTabId, type TabId, type TabDef } from './tabs-config';

interface Props {
  /** バッジ件数。未指定の項目はバッジ非表示 */
  badges?: Partial<Record<TabId, number>>;
}

export function DashboardTabBar({ badges }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('tab');
  const active: TabId = isTabId(raw) ? raw : DEFAULT_TAB;

  function go(id: TabId) {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', id);
    router.replace(`/dashboard?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="flex bg-surface-base border-b border-surface-border flex-shrink-0">
      {TABS.map((t) => (
        <TabItem
          key={t.id}
          tab={t}
          active={t.id === active}
          badge={badges?.[t.id]}
          onClick={() => go(t.id)}
        />
      ))}
    </div>
  );
}

function TabItem({
  tab,
  active,
  badge,
  onClick,
}: {
  tab: TabDef;
  active: boolean;
  badge: number | undefined;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-1 py-2 text-2xs text-center border-r border-surface-border last:border-r-0 transition-colors relative select-none ${
        active
          ? 'bg-surface-panel text-accent-amber font-bold'
          : 'text-ink-subtle hover:bg-surface-panel hover:text-ink-strong'
      }`}
      type="button"
      aria-current={active ? 'page' : undefined}
    >
      <span className="leading-none mr-0.5">{tab.icon}</span>
      <span className="leading-none">{tab.label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={`inline-block min-w-[14px] px-1 ml-1 rounded-full text-[9px] font-bold align-middle leading-[14px] ${
            tab.badgeVariant === 'warn'
              ? 'bg-amber-700 text-amber-100'
              : 'bg-status-error text-white'
          }`}
        >
          {badge}
        </span>
      )}
      {active && (
        <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent-amber" />
      )}
    </button>
  );
}
