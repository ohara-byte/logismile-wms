/** ハンディ ホーム — ピッキング№スキャン入力 */

import { getEmployeeSession } from '@/lib/auth/employee-session';
import { LogoutButton } from '@/components/employee-logout-button';
import { PickingNoScanForm } from './_components/picking-no-scan-form';

export default async function HandyHome() {
  const session = await getEmployeeSession();

  return (
    <main className="min-h-screen bg-gray-50 p-3">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-2 px-1">
          <div>
            <h1 className="text-base font-bold">ハンディ検品</h1>
            <p className="text-[10px] text-gray-500">
              {session?.name}（{session?.empCode}） / {session?.deviceCode}
            </p>
          </div>
          <LogoutButton variant="handy" />
        </div>

        <div className="bg-white rounded-xl shadow-md p-4">
          <h2 className="text-sm font-semibold mb-2">ピッキング№ をスキャン</h2>
          <p className="text-[11px] text-gray-500 mb-3">
            BT-A500 でバーコードをスキャン（Enter で送信）
          </p>
          <PickingNoScanForm />
        </div>
      </div>
    </main>
  );
}
