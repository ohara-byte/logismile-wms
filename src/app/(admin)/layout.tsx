/**
 * (admin) ルートグループのレイアウト
 *
 * このグループ配下のページは管理PC（admin / manager）認証必須。
 * ログインページは別ツリー (/login) に配置しているため、ここでは無条件にチェック。
 */

import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/auth-options';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';
import { signOutAction } from './_actions';
import { AdminClock } from './_components/admin-clock';
import { AdminNav } from './_components/admin-nav';
import { NAV_GROUPS } from './_components/admin-nav-config';

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
    <div className="min-h-screen bg-surface-base text-ink">
      <header className="bg-gradient-to-b from-surface-panel to-surface-base border-b border-surface-border sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center gap-4">
          {/* ブランド */}
          <a href="/dashboard" className="flex items-center gap-2.5 shrink-0">
            <LogiSmileLogo height={26} />
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-3xs text-ink-subtle uppercase tracking-wider">
                大江ノ郷自然牧場
              </span>
              <span className="text-3xs text-ink-muted">管理コンソール</span>
            </div>
          </a>

          {/* ナビ（タブグループ） */}
          <AdminNav groups={NAV_GROUPS} />

          {/* 右側: 時計 + ユーザー */}
          <div className="flex items-center gap-3 shrink-0">
            <AdminClock />
            <div className="flex items-center gap-2 px-2.5 py-1 bg-surface-panel rounded border border-surface-border">
              <span className="w-7 h-7 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center text-xs font-bold">
                {session.user.name?.[0] ?? '?'}
              </span>
              <div className="hidden sm:flex flex-col leading-tight">
                <span className="text-xs font-bold text-ink-strong">{session.user.name}</span>
                <span className="text-3xs text-ink-muted uppercase">{session.user.role}</span>
              </div>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="ml-1 text-3xs text-ink-subtle hover:text-status-error transition-colors"
                  title="ログアウト"
                >
                  ⏻
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
