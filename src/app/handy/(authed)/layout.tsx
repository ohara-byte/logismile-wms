/**
 * /handy/(authed) — 社員番号セッション必須（タブレットと同様）
 */

import { redirect } from 'next/navigation';
import { getEmployeeSession } from '@/lib/auth/employee-session';

export default async function HandyAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getEmployeeSession();
  if (!session) redirect('/handy/login');
  return <>{children}</>;
}
