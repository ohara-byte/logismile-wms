/** ハンディ ホーム — ピッキング№スキャン待機（Phase 7-4 — モック準拠 UI） */

import { getEmployeeSession } from '@/lib/auth/employee-session';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';
import { LogoutButton } from '@/components/employee-logout-button';
import { PickingNoScanForm } from './_components/picking-no-scan-form';

export default async function HandyHome() {
  const session = await getEmployeeSession();

  return (
    <main className="min-h-screen bg-surface-base text-ink flex flex-col">
      {/* ヘッダ（薄め、ハンディは画面狭いので必要最小限） */}
      <header className="bg-surface-panel border-b border-surface-border h-9 flex items-center px-2 gap-2 shrink-0">
        <LogiSmileLogo height={16} />
        <span className="text-3xs text-ink-muted">ハンディ</span>
        <div className="flex-1" />
        {session && (
          <span className="text-3xs text-ink-subtle font-mono">{session.deviceCode}</span>
        )}
        <LogoutButton variant="handy" />
      </header>

      {/* idle スキャン待機 */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="text-center mb-4">
          <div className="relative inline-block">
            <div className="text-7xl">📄</div>
            <div className="absolute inset-0 rounded-full animate-pulse bg-accent-amber/10 blur-xl" />
          </div>
        </div>
        <h1 className="text-base font-bold text-accent-amber tracking-wider mb-1 text-center">
          ピッキング№
        </h1>
        <p className="text-3xs text-ink-subtle mb-4 text-center">
          BT-A500 でバーコードをスキャン
        </p>
        <div className="w-full max-w-xs">
          <PickingNoScanForm currentStaffCode={session?.staffCode} />
        </div>

        <div className="mt-8 text-3xs text-ink-muted text-center">
          {session?.name}（{session?.empCode}）
        </div>
      </div>
    </main>
  );
}
