/** 管理PC ログインページ — メール+パスワード（NextAuth credentials） */

import { Suspense } from 'react';
import { LoginForm } from './_components/login-form';

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="text-gray-400 text-sm">読み込み中…</div>
    </main>
  );
}
