/** ハンディ検品 — ログイン後ランディング（Phase 4 で検品フローに置換） */

import { getEmployeeSession } from '@/lib/auth/employee-session';
import { LogoutButton } from '@/components/employee-logout-button';

export default async function HandyHome() {
  const session = await getEmployeeSession();
  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-md p-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold">ハンディ検品</h1>
          <LogoutButton variant="handy" />
        </div>
        <p className="text-sm text-gray-600 mb-4">
          {session?.name} さん（社員番号 {session?.empCode}）<br />
          検品フローは Phase 4 で実装予定です。
        </p>
        <dl className="grid grid-cols-2 gap-2 text-xs bg-gray-50 rounded p-3">
          <dt className="text-gray-500">担当者コード</dt>
          <dd>{session?.staffCode}</dd>
          <dt className="text-gray-500">端末コード</dt>
          <dd>{session?.deviceCode}</dd>
          <dt className="text-gray-500">ロール</dt>
          <dd>{session?.role}</dd>
        </dl>
      </div>
    </main>
  );
}
