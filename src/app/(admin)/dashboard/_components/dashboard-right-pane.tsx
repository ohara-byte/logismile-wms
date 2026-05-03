'use client';

/**
 * 管理PC ダッシュボード右ペイン
 *
 * tab-bar + tab-content のラッパ。
 * 現在の active タブに応じて pane を切り替える。
 *
 * 各 pane の中身は Sprint A-04 以降で実装する。
 * 既存の独立ページ (/orders /imports etc.) は legacyHref で導線を残す。
 */

import { useSearchParams } from 'next/navigation';
import { DEFAULT_TAB, isTabId, type TabId } from './tabs-config';
import { DashboardTabBar } from './dashboard-tab-bar';
import { PlaceholderPane } from './panes/placeholder-pane';
import { AlertsPane } from './panes/alerts-pane';
import { ForcePane } from './panes/force-pane';
import { AnnPane } from './panes/ann-pane';
import { CarrPane } from './panes/carr-pane';

interface Props {
  badges?: Partial<Record<TabId, number>>;
}

export function DashboardRightPane({ badges }: Props) {
  const params = useSearchParams();
  const raw = params.get('tab');
  const active: TabId = isTabId(raw) ? raw : DEFAULT_TAB;

  return (
    <div className="flex flex-col overflow-hidden bg-surface-panel border border-surface-border rounded-lg">
      <DashboardTabBar badges={badges} />
      <div className="flex-1 overflow-auto">
        <PaneContent tab={active} />
      </div>
    </div>
  );
}

function PaneContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'alerts':
      return <AlertsPane />;
    case 'force':
      return <ForcePane />;
    case 'ann':
      return <AnnPane />;
    case 'carr':
      return <CarrPane />;
    case 'search':
      return (
        <PlaceholderPane
          title="🔍 検索"
          block="A-08"
          legacyHref="/orders"
          legacyLabel="従来の出荷指示一覧へ"
        />
      );
    case 'csv':
      return (
        <PlaceholderPane
          title="📁 CSV 取込・出力"
          block="A-07-CSV"
          legacyHref="/imports"
          legacyLabel="従来の CSV 取込画面へ"
        />
      );
    case 'master':
      return (
        <PlaceholderPane
          title="⚙ マスタ管理（10 サブタブ）"
          block="A-09 / A-10"
          legacyHref="/shift"
          legacyLabel="従来のシフト画面へ"
        />
      );
    case 'link':
      return (
        <PlaceholderPane title="🔌 基幹連携（7 サブタブ）" block="A-11" />
      );
    case 'report':
      return (
        <PlaceholderPane
          title="📊 レポート（11 サブタブ）"
          block="A-（独立ブロック）"
          legacyHref="/reports"
          legacyLabel="従来のレポート画面へ"
        />
      );
    case 'match':
      return (
        <PlaceholderPane title="📋 未検品照合" block="A-12" />
      );
  }
}
