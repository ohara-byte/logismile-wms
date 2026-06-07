/**
 * 📊 在庫検品メニュー（Sprint Z-1 / Phase A-5）
 *
 * ハンディ待機画面で F3 押下 → このメニューへ。
 *  - 「在庫検品」: JAN/商品コードをスキャンして物理カウントを入力
 *  - 「待機に戻る」: 出荷検品メニューへ戻る
 *
 * 既存の出荷検品フローには影響しない。InspSession ではなく StockAllocSession を使用。
 */

import { getEmployeeSession } from '@/lib/auth/employee-session';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';
import { LogoutButton } from '@/components/employee-logout-button';
import { StockMenu } from './_components/stock-menu';

export default async function HandyStockPage() {
  const session = await getEmployeeSession();

  return (
    <main className="min-h-screen bg-surface-base text-ink flex flex-col">
      {/* ヘッダ（薄め） */}
      <header className="bg-surface-panel border-b border-surface-border h-9 flex items-center px-2 gap-2 shrink-0">
        <LogiSmileLogo height={16} />
        <span className="text-3xs text-ink-muted">在庫検品</span>
        <div className="flex-1" />
        {session && (
          <span className="text-3xs text-ink-subtle font-mono">
            {session.deviceCode}
          </span>
        )}
        <LogoutButton variant="handy" />
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <h1 className="text-base font-bold text-accent-amber tracking-wider mb-2 text-center">
          📊 在庫検品メニュー
        </h1>
        <p className="text-3xs text-ink-subtle mb-5 text-center">
          商品ごとに物理在庫をカウント → 自動で引当に反映されます
        </p>
        <div className="w-full max-w-xs">
          <StockMenu />
        </div>
        <div className="mt-6 text-3xs text-ink-muted text-center">
          {session?.name}（{session?.empCode}）
        </div>
      </div>
    </main>
  );
}
