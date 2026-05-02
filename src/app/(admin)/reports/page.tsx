/**
 * レポート（Phase 5-16〜5-22）
 *
 * - サマリー / 担当者MH / グループMH / 商品ABC / ヒートマップ
 * - 期間 from/to + 各レポートタブ
 * - CSV ダウンロード
 */

import { ReportsClient } from './_components/reports-client';

export default function ReportsPage() {
  return (
    <main className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">レポート</h1>
      <ReportsClient />
    </main>
  );
}
