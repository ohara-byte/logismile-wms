/** ハンディ 発送日別 受入検品（Phase 5・2026-07-02）。発送日を選び、入庫予定商品ごとに検品実数を記録。 */

import { getEmployeeSession } from '@/lib/auth/employee-session';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';
import { LogoutButton } from '@/components/employee-logout-button';
import { ReceivingInspectClient } from './_components/receiving-inspect-client';

export default async function HandyReceivingPage() {
  const session = await getEmployeeSession();

  return (
    <main className="min-h-screen bg-surface-base text-ink flex flex-col">
      <header className="bg-surface-panel border-b border-surface-border h-9 flex items-center px-2 gap-2 shrink-0">
        <a href="/handy" className="text-accent-amber text-sm">
          ‹
        </a>
        <LogiSmileLogo height={16} />
        <span className="text-3xs text-ink-muted">受入検品</span>
        <div className="flex-1" />
        {session && <span className="text-3xs text-ink-subtle font-mono">{session.deviceCode}</span>}
        <LogoutButton variant="handy" />
      </header>

      <ReceivingInspectClient />
    </main>
  );
}
