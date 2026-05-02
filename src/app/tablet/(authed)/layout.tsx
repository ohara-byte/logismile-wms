/**
 * /tablet/(authed) — 社員番号セッション必須
 *
 * /tablet/login は (authed) グループの外なのでこのレイアウトは適用されない。
 */

import { redirect } from 'next/navigation';
import { getEmployeeSession } from '@/lib/auth/employee-session';

export default async function TabletAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getEmployeeSession();
  if (!session) redirect('/tablet/login');
  return <>{children}</>;
}
