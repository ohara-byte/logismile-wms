/**
 * 管理PC ダッシュボード（Phase 5-1〜5-5）
 *
 * - 全体進捗カード
 * - グループ別進捗カード（終了予定時刻 + 遅延フラグ）
 * - 段階目標 vs 予測（折れ線風）
 * - アラート一覧（未解決優先）
 *
 * SSE は未実装。ポーリング 5 秒間隔で更新。
 */

import { DashboardClient } from './_components/dashboard-client';

export default function DashboardPage() {
  return (
    <main className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">ダッシュボード</h1>
      <DashboardClient />
    </main>
  );
}
