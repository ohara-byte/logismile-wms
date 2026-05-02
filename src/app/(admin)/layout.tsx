/**
 * (admin) ルートグループのレイアウト
 *
 * このグループ配下のページは管理PC（admin / manager）認証必須。
 * ログインページは別ツリー (/login) に配置しているため、ここでは無条件にチェック。
 */

import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/auth-options';
import { signOutAction } from './_actions';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="font-bold text-gray-800">大江ノ郷WMS 管理PC</span>
            <nav className="flex gap-3 text-sm">
              <a href="/dashboard" className="text-gray-700 hover:text-blue-600">
                ダッシュボード
              </a>
              <a href="/orders" className="text-gray-700 hover:text-blue-600">
                出荷指示
              </a>
              <a href="/imports" className="text-gray-700 hover:text-blue-600">
                CSV取込
              </a>
              <a href="/notices" className="text-gray-700 hover:text-blue-600">
                連絡事項
              </a>
              <a href="/shift" className="text-gray-700 hover:text-blue-600">
                シフト
              </a>
              <a href="/assignment" className="text-gray-700 hover:text-blue-600">
                割当
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">
              {session.user.name} ({session.user.role})
            </span>
            <form action={signOutAction}>
              <button className="text-blue-600 hover:underline" type="submit">
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
