/** タブレット検品 — ログイン後ランディング（Phase 3 で検品フローに置換） */

import { getEmployeeSession } from '@/lib/auth/employee-session';
import { LogoutButton } from '@/components/employee-logout-button';

export default async function TabletHome() {
  const session = await getEmployeeSession();
  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">タブレット検品</h1>
          <LogoutButton variant="tablet" />
        </div>
        <p className="text-sm text-gray-600 mb-6">
          ようこそ {session?.name} さん（社員番号 {session?.empCode}）。<br />
          検品フローは Phase 3 で実装予定です。
        </p>
        <dl className="grid grid-cols-2 gap-2 text-sm bg-gray-50 rounded p-4">
          <dt className="text-gray-500">担当者コード</dt>
          <dd>{session?.staffCode}</dd>
          <dt className="text-gray-500">端末コード</dt>
          <dd>{session?.deviceCode}</dd>
          <dt className="text-gray-500">ロール</dt>
          <dd>{session?.role}</dd>
          <dt className="text-gray-500">セッション有効</dt>
          <dd>{session?.exp ? new Date(session.exp * 1000).toLocaleString('ja-JP') : '—'} まで</dd>
        </dl>
      </div>
    </main>
  );
}
