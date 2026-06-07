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
import { AlertsPane } from './panes/alerts-pane';
import { ForcePane } from './panes/force-pane';
import { AnnPane } from './panes/ann-pane';
import { CarrPane } from './panes/carr-pane';
import { SearchPane } from './panes/search-pane';
import { MatchPane } from './panes/match-pane';
import { MasterPane } from './panes/master/master-pane';
import { LinkPane } from './panes/link/link-pane';
import { ReportPane } from './panes/report/report-pane';
import { MfgPane } from './panes/mfg-pane';
import { StockMatchPane } from './panes/stock-match-pane';

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
      return <SearchPane />;
    case 'master':
      return <MasterPane />;
    case 'link':
      return <LinkPane />;
    case 'report':
      return <ReportPane />;
    case 'match':
      return <MatchPane />;
    case 'stockmatch':
      return <StockMatchPane />;
    case 'mfg':
      return <MfgPane />;
  }
}
