'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';
import { Button } from '@/components/ui/button';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // callbackUrl は同一オリジン内パス（先頭 "/" + 2文字目が "/" でない）のみ許可。
  // "//evil.com" のようなプロトコル相対 URL は弾く（オープンリダイレクト対策）。
  const rawCallback = params.get('callbackUrl') || '/dashboard';
  const callbackUrl =
    rawCallback.startsWith('/') && !rawCallback.startsWith('//') ? rawCallback : '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);

    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setBusy(false);
    if (res?.ok) {
      router.replace(callbackUrl);
      router.refresh();
    } else {
      setErrorMsg('メールアドレスまたはパスワードが違います');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-surface-base p-6">
      <div className="max-w-sm w-full">
        <div className="mb-6 text-center">
          <LogiSmileLogo height={48} className="mx-auto mb-2" />
          <p className="text-2xs text-ink-muted uppercase tracking-wider">管理コンソール</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-surface-panel border border-surface-border rounded-xl shadow-modal p-6 space-y-4"
        >
          <div>
            <h1 className="text-base font-bold text-accent-amber uppercase tracking-wider">
              管理 PC ログイン
            </h1>
            <p className="text-2xs text-ink-subtle mt-0.5">メール + パスワードで認証</p>
          </div>

          <div>
            <label className="block text-2xs font-bold text-ink-subtle uppercase tracking-wider mb-1.5">
              メールアドレス
            </label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-surface-base border border-surface-border-strong text-ink-strong rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-amber focus:ring-1 focus:ring-accent-amber/40"
              placeholder="admin@wms.local"
            />
          </div>

          <div>
            <label className="block text-2xs font-bold text-ink-subtle uppercase tracking-wider mb-1.5">
              パスワード
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-base border border-surface-border-strong text-ink-strong rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-amber focus:ring-1 focus:ring-accent-amber/40"
            />
          </div>

          {errorMsg && (
            <div className="text-xs text-status-error bg-status-error-bg border border-status-error/40 rounded p-2.5">
              {errorMsg}
            </div>
          )}

          <Button type="submit" disabled={busy} className="w-full" size="lg">
            {busy ? 'ログイン中…' : 'ログイン'}
          </Button>
        </form>

        <p className="mt-4 text-3xs text-ink-muted text-center">
          © LogiSmile / 大江ノ郷自然牧場
        </p>
      </div>
    </main>
  );
}
