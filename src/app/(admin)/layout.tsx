/**
 * (admin) ルートグループのレイアウト
 *
 * このグループ配下のページは管理PC（admin / manager）認証必須。
 * ログインページは別ツリー (/login) に配置しているため、ここでは無条件にチェック。
 *
 * ヘッダ構成（モック準拠 v0.22 L2285-2298）:
 *   ブランド | KPI チップ群（接続/日付/出荷/完了/締切） | spacer | 時計 | ユーザー
 *
 * 横タブナビは廃止し、ナビゲーションはダッシュボード右ペインの 10 タブに統一する（A-02）。
 */

import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth/auth-options';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';
import { BadgeProvider } from '@/components/admin/badge-context';
import { OrderDetailProvider } from '@/components/admin/order-detail-context';
import { RoleProvider } from '@/components/admin/role-context';
import { signOutAction } from './_actions';
import { AdminClock } from './_components/admin-clock';
import { AdminTopChips } from './_components/admin-top-chips';

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
    <RoleProvider role={session.user.role}>
    <BadgeProvider>
      <OrderDetailProvider>
      <div className="min-h-screen bg-surface-base text-ink">
        <header className="bg-gradient-to-b from-surface-panel to-surface-base border-b border-surface-border sticky top-0 z-30">
        <div className="max-w-[1920px] mx-auto px-3 h-16 flex items-center gap-2.5">
          {/* ブランド（Sprint E-1: ロゴ最大化 / 26px → 38px） */}
          <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0">
            <LogiSmileLogo height={38} />
            <div className="hidden lg:flex flex-col leading-tight border-l border-surface-border pl-2.5 ml-1">
              <span className="text-2xs text-ink-subtle">大江ノ郷自然牧場</span>
              <span className="text-2xs text-ink-muted">管理コンソール</span>
            </div>
          </Link>

          {/* KPI チップ群 */}
          <AdminTopChips />

          {/* H-3: クイックリンク — シフト/レポート/割当/マスタへ */}
          <nav className="flex items-center gap-1 shrink-0 ml-1">
            <NavChip href="/dashboard" label="ダッシュボード" icon="📊" />
            <NavChip href="/orders" label="伝票一覧" icon="📋" />
            {/* 2026-07-02: 検品照合はフル画面 /stock-match へ独立（旧リンクは誤って出荷照合(tab=match)へ遷移していた）。*/}
            <NavChip
              href="/stock-match"
              label="検品照合"
              icon="📦"
              accent
            />
            <NavChip href="/imports" label="CSV取込" icon="📁" />
            <NavChip href="/shift" label="シフト" icon="📅" />
            <NavChip href="/reports" label="レポート" icon="📈" />
            <NavChip href="/print-test" label="プリンタ試刷" icon="🖨" />
            {/* Sprint Z-7: 「設定」をヘッダーへ移動。Sprint Y-13: admin のみ表示。 */}
            {session.user.role === 'admin' && (
              <NavChip href="/settings" label="設定" icon="🛠" />
            )}
          </nav>

          {/* 右側: 時計 + ユーザー */}
          <div className="flex items-center gap-2 shrink-0">
            <AdminClock />
            <div className="flex items-center gap-2 px-2 py-1 bg-surface-panel rounded border border-surface-border">
              <span className="w-7 h-7 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center text-xs font-bold">
                {session.user.name?.[0] ?? '?'}
              </span>
              <div className="hidden md:flex flex-col leading-tight">
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
      </OrderDetailProvider>
    </BadgeProvider>
    </RoleProvider>
  );
}

function NavChip({
  href,
  label,
  icon,
  accent,
}: {
  href: string;
  label: string;
  icon: string;
  /** Sprint Z-2: 重要業務のリンク（検品照合）をハイライト表示 */
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        accent
          ? 'px-2.5 py-1 rounded text-2xs font-bold border transition-colors flex items-center gap-1 bg-purple-900 border-purple-500 text-purple-100 hover:bg-purple-800 hover:text-white'
          : 'px-2 py-1 rounded text-2xs text-ink-subtle hover:text-accent-amber hover:bg-surface-panel border border-transparent hover:border-surface-border transition-colors flex items-center gap-1'
      }
    >
      <span>{icon}</span>
      <span className={accent ? 'inline' : 'hidden xl:inline'}>{label}</span>
    </Link>
  );
}
