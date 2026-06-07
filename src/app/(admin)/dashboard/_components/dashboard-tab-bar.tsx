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
import { useRole } from '@/components/admin/role-context';
import {
  hasPermission,
  type PermissionKey,
} from '@/lib/auth/permissions-shared';

// Sprint Y-11: 各タブを表示するために必要な権限
const TAB_REQUIRED_PERM: Partial<Record<TabId, PermissionKey>> = {
  // alerts/ann/carr/search は全ロール閲覧可（権限指定なし）
  force: 'force_approve', // 強制OK 承認は admin/manager のみ
  master: 'master_view', // マスタ閲覧
  link: 'master_edit', // 基幹連携系（取込制御）は編集権限
  report: 'reports_view',
  match: 'force_approve', // 検品照合はマネジメント機能
  // Sprint Z-3: 在庫引当業務タブ
  stockmatch: 'master_view', // 商品検品照合は閲覧（lead OK）
  mfg: 'master_view', // 製造指示は閲覧（lead OK・送信は admin/manager）
};

interface Props {
  /** バッジ件数。未指定の項目はバッジ非表示 */
  badges?: Partial<Record<TabId, number>>;
}

export function DashboardTabBar({ badges }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('tab');
  const active: TabId = isTabId(raw) ? raw : DEFAULT_TAB;
  const role = useRole();

  // ロール権限でフィルタ
  const visibleTabs = TABS.filter((t) => {
    const perm = TAB_REQUIRED_PERM[t.id];
    if (!perm) return true; // 権限指定なしは全ロール表示
    return hasPermission(role, perm);
  });

  function go(id: TabId) {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', id);
    router.replace(`/dashboard?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="flex bg-surface-base border-b border-surface-border flex-shrink-0">
      {visibleTabs.map((t) => (
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
  // Sprint Y-4: 各タブセルは「アイコン+ラベル」「バッジ」の最大 2 行に収まるよう調整
  //   - ラベルは whitespace-nowrap で 1 行固定
  //   - フォント 11px / padding 控えめ
  //   - バッジは下段に配置
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-1.5 py-2 text-center border-r border-surface-border last:border-r-0 transition-colors relative select-none ${
        active
          ? 'bg-surface-panel text-accent-amber font-bold'
          : 'text-ink-subtle hover:bg-surface-panel hover:text-ink-strong'
      }`}
      type="button"
      aria-current={active ? 'page' : undefined}
      style={{ fontSize: 11, lineHeight: 1.2 }}
    >
      <div className="flex items-center justify-center gap-1 whitespace-nowrap">
        <span style={{ fontSize: 13 }}>{tab.icon}</span>
        <span>{tab.label}</span>
      </div>
      {badge !== undefined && badge > 0 && (
        <div className="mt-1 flex justify-center">
          <span
            className={`inline-block min-w-[20px] px-1.5 rounded-full font-bold leading-[16px] ${
              tab.badgeVariant === 'warn'
                ? 'bg-amber-700 text-amber-100'
                : 'bg-status-error text-white'
            }`}
            style={{ fontSize: 10 }}
          >
            {badge}
          </span>
        </div>
      )}
      {active && (
        <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent-amber" />
      )}
    </button>
  );
}
