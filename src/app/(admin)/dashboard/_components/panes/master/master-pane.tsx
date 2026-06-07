'use client';

/**
 * ⚙ マスタ管理 タブ本体（A-09）
 *
 * モック準拠（管理用PCモック_v0.22.html L3002-3042）。
 *
 * - 上部に 10 サブタブ
 * - 選択中の MasterConfig に応じて MasterTable を描画
 * - サブタブは ?msub=<id> で URL 同期
 */

import { useRouter, useSearchParams } from 'next/navigation';
import {
  DEFAULT_MASTER_SUBTAB,
  MASTER_SUBTABS,
  isMasterSubTabId,
  type MasterSubTabId,
} from './master-tabs-config';
import { MasterTable } from './master-table';
import { getMasterConfig } from './configs';
import { ShiftClient } from '@/app/(admin)/shift/_components/shift-client';
import { useRole } from '@/components/admin/role-context';

export function MasterPane() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('msub');
  const active: MasterSubTabId = isMasterSubTabId(raw) ? raw : DEFAULT_MASTER_SUBTAB;
  const role = useRole();
  // Sprint Y-12: adminOnly タブは admin ロールのみに表示
  const visibleSubtabs = MASTER_SUBTABS.filter(
    (t) => !t.adminOnly || role === 'admin',
  );

  function go(id: MasterSubTabId) {
    const sp = new URLSearchParams(params.toString());
    sp.set('msub', id);
    router.replace(`/dashboard?${sp.toString()}`, { scroll: false });
  }

  const config = getMasterConfig(active);

  return (
    <div className="flex flex-col h-full">
      {/* サブタブバー — Sprint Y-1 でフォント・パディング拡大 */}
      <div className="flex flex-wrap gap-1.5 px-3 py-2 bg-surface-base border-b border-surface-border">
        {visibleSubtabs.map((t) => (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-colors whitespace-nowrap border-2 ${
              t.id === active
                ? 'bg-brand-primary text-white border-brand-primary'
                : 'bg-surface-panel text-ink-subtle border-surface-border hover:text-ink hover:border-accent-amber/60'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3">
        {/* Sprint Q-5: シフトはマトリクス UI 付きの ShiftClient を直接埋め込む（モック準拠） */}
        {active === 'shift' ? (
          <ShiftClient />
        ) : config ? (
          <MasterTable config={config} />
        ) : (
          <div className="text-sm text-ink-muted p-6 text-center">
            🚧 「{MASTER_SUBTABS.find((t) => t.id === active)?.label}」マスタは A-10 の続編で実装予定です
          </div>
        )}
      </div>
    </div>
  );
}
