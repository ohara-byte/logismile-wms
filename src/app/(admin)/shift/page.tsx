/**
 * シフト管理（Phase 5-10, 5-11, 5-15）
 *
 * - シフトマトリクス表示（縦=担当者、横=日付）
 * - GPシフトCSV取込（4ステップ：upload → preview → confirm → execute）
 */

import { ShiftClient } from './_components/shift-client';

export default function ShiftPage() {
  return (
    <main className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">シフト管理</h1>
      <ShiftClient />
    </main>
  );
}
