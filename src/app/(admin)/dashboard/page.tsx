/**
 * 管理PC ダッシュボード（Phase 7-2 — モック準拠 UI）
 *
 * 4 段グリッド:
 *  1. 108px: KPI ストリップ（4 枚）
 *  2. 1fr  : テーブルグループ別進捗 + アラート
 *  3. 96px : 独立作業エリア（ライン / 仕分 / SAS）
 *  4. 208px: 1 時間別実績 + 30 分要員配置
 */

import { DashboardClient } from './_components/dashboard-client';

export default function DashboardPage() {
  return <DashboardClient />;
}
