'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

/**
 * NextAuth のサインアウト相当を Server Action で実装。
 * `next-auth/react` の signOut() は client component 専用なので、
 * Server Components 配下のレイアウトからは Cookie を直接削除する。
 */
export async function signOutAction() {
  const c = cookies();
  // dev は __Secure- なしのプレーン名。本番環境は __Secure-next-auth.session-token。
  for (const name of [
    'next-auth.session-token',
    '__Secure-next-auth.session-token',
    'next-auth.csrf-token',
    '__Host-next-auth.csrf-token',
    'next-auth.callback-url',
  ]) {
    c.set(name, '', { path: '/', maxAge: 0 });
  }
  redirect('/login');
}
