/** タブレット ホーム — ピッキング№スキャン入力 */

import { getEmployeeSession } from '@/lib/auth/employee-session';
import { LogoutButton } from '@/components/employee-logout-button';
import { PickingNoScanForm } from './_components/picking-no-scan-form';

export default async function TabletHome() {
  const session = await getEmployeeSession();

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4 px-2">
          <div>
            <h1 className="text-xl font-bold">タブレット検品</h1>
            <p className="text-xs text-gray-500">
              {session?.name}（{session?.empCode}） / {session?.deviceCode}
            </p>
          </div>
          <LogoutButton variant="tablet" />
        </div>

        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-lg font-semibold mb-3">ピッキング№ をスキャン</h2>
          <p className="text-xs text-gray-500 mb-4">
            出荷指示書のバーコードをスキャンしてください。手入力も可能です。
          </p>
          <PickingNoScanForm />
        </div>
      </div>
    </main>
  );
}
