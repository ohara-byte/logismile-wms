/** タブレット ホーム — ピッキング№スキャン待機（Phase 7-3 — モック準拠 UI） */

import { getEmployeeSession } from '@/lib/auth/employee-session';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';
import { LogoutButton } from '@/components/employee-logout-button';
import { PickingNoScanForm } from './_components/picking-no-scan-form';

export default async function TabletHome() {
  const session = await getEmployeeSession();

  return (
    <main className="min-h-screen bg-surface-base text-ink flex flex-col">
      {/* ヘッダ */}
      <header className="bg-surface-panel border-b border-surface-border h-12 flex items-center px-3 gap-3 shrink-0">
        <LogiSmileLogo height={22} />
        <div className="text-3xs text-ink-muted">タブレット v0.18</div>
        <div className="flex-1" />
        {session && (
          <div className="flex items-center gap-1.5 text-2xs text-ink-subtle px-2 py-1 bg-surface-base rounded border border-surface-border">
            <span className="w-5 h-5 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center text-3xs font-bold">
              {session.name[0]}
            </span>
            <span>{session.name}</span>
            <span className="text-ink-muted">/ {session.deviceCode}</span>
          </div>
        )}
        <LogoutButton variant="tablet" />
      </header>

      {/* idle スキャン待機 */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="text-center mb-8">
          <div className="relative inline-block">
            <div className="text-9xl">📄</div>
            <div className="absolute inset-0 rounded-full animate-pulse bg-accent-amber/10 blur-2xl" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-accent-amber tracking-wider mb-2">
          ピッキング№バーコードをスキャン
        </h1>
        <p className="text-xs text-ink-subtle mb-6">
          外付スキャナで読み取るか、下のフォームに直接入力してください
        </p>
        <div className="w-full max-w-md">
          <PickingNoScanForm />
        </div>

        <div className="mt-12 text-3xs text-ink-muted text-center space-y-0.5">
          <div>
            社員: <span className="text-ink-subtle">{session?.name}</span>（
            {session?.empCode}）
          </div>
          <div>
            端末: <span className="text-ink-subtle">{session?.deviceCode}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
