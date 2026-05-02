/**
 * 管理PC 伝票管理ページ（Phase 5-6, 5-7, 5-8）
 *
 * - フィルタ（出荷日 / status / q / carrier / 削除済み含む）
 * - 一覧テーブル
 * - 行クリック → 詳細モーダル
 * - 納品書バーコード照合（クイック検索）
 */

import { OrdersClient } from './_components/orders-client';

export default function OrdersPage() {
  return (
    <main className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">出荷指示</h1>
      <OrdersClient />
    </main>
  );
}
