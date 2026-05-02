/**
 * 管理PC 連絡事項管理（Phase 5-9）
 *
 * - 一覧（日付・対象範囲・優先度・有効）
 * - 新規作成（日付/タイトル/本文/対象/優先度）
 * - 編集 / 無効化
 */

import { NoticesClient } from './_components/notices-client';

export default function NoticesPage() {
  return (
    <main className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">連絡事項</h1>
      <NoticesClient />
    </main>
  );
}
