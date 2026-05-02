'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

/** 管理PC ログインページ — メール+パスワード（NextAuth credentials） */
export default function AdminLoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  // callbackUrl は同一オリジン内パス（先頭 "/" + 2文字目が "/" でない）のみ許可。
  // "//evil.com" のようなプロトコル相対 URL は弾く（オープンリダイレクト対策）。
  const rawCallback = params.get('callbackUrl') || '/imports';
  const callbackUrl =
    rawCallback.startsWith('/') && !rawCallback.startsWith('//') ? rawCallback : '/imports';

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
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <form
        onSubmit={onSubmit}
        className="max-w-sm w-full bg-white rounded-xl shadow-md p-8 space-y-4"
      >
        <h1 className="text-xl font-bold text-gray-800">管理PC ログイン</h1>
        <p className="text-xs text-gray-500">メール + パスワードで認証</p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            メールアドレス
          </label>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="admin@wms.local"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            パスワード
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        {errorMsg && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-blue-600 text-white rounded py-2 font-medium hover:bg-blue-700 disabled:bg-gray-300"
        >
          {busy ? 'ログイン中…' : 'ログイン'}
        </button>

        <p className="text-xs text-gray-400 pt-2">
          初期: admin@wms.local / admin123
        </p>
      </form>
    </main>
  );
}
