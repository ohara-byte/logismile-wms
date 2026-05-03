/** ルートページ — 端末別ログイン入口（LogiSmile ブランディング） */

import Link from 'next/link';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-surface-base p-6">
      {/* ヘッダ */}
      <div className="mb-10 text-center">
        <LogiSmileLogo height={56} className="mx-auto mb-3" />
        <p className="text-sm text-ink-subtle">大江ノ郷自然牧場 倉庫管理システム</p>
      </div>

      <div className="max-w-md w-full bg-surface-panel border border-surface-border rounded-xl shadow-modal p-6">
        <h2 className="text-xs font-bold text-accent-amber uppercase tracking-wider mb-4">
          端末を選択してください
        </h2>

        <div className="space-y-3">
          <NavCard
            href="/login"
            title="管理 PC"
            description="メールアドレス + パスワード"
            icon="💻"
          />
          <NavCard
            href="/tablet/login"
            title="タブレット検品"
            description="社員番号でログイン（HP14）"
            icon="📱"
          />
          <NavCard
            href="/handy/login"
            title="ハンディ検品"
            description="社員番号でログイン（KEYENCE BT-A500）"
            icon="📡"
          />
        </div>

        <p className="text-2xs text-ink-muted mt-6 text-center">
          認証はそれぞれ別系統です
        </p>
      </div>

      <p className="mt-6 text-3xs text-ink-muted">© LogiSmile / 大江ノ郷自然牧場</p>

      <Link
        href="/mocks"
        className="mt-2 text-3xs text-ink-muted hover:text-accent-amber transition-colors"
      >
        🧪 モック ビューア（要件確認用）
      </Link>
    </main>
  );
}

function NavCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 border border-surface-border rounded-lg p-4 bg-surface-base hover:bg-surface-raised hover:border-brand-primary/60 transition group"
    >
      <div className="text-3xl">{icon}</div>
      <div className="flex-1">
        <div className="font-semibold text-ink-strong group-hover:text-accent-amber transition-colors">
          {title}
        </div>
        <div className="text-2xs text-ink-subtle">{description}</div>
      </div>
      <div className="text-ink-muted group-hover:text-accent-amber transition-colors">→</div>
    </Link>
  );
}
