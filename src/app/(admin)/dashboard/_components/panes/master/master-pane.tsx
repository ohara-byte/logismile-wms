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

export function MasterPane() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('msub');
  const active: MasterSubTabId = isMasterSubTabId(raw) ? raw : DEFAULT_MASTER_SUBTAB;

  function go(id: MasterSubTabId) {
    const sp = new URLSearchParams(params.toString());
    sp.set('msub', id);
    router.replace(`/dashboard?${sp.toString()}`, { scroll: false });
  }

  const config = getMasterConfig(active);

  return (
    <div className="flex flex-col h-full">
      {/* サブタブバー */}
      <div className="flex flex-wrap gap-1 px-2 py-1.5 bg-surface-base border-b border-surface-border">
        {MASTER_SUBTABS.map((t) => (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors whitespace-nowrap border ${
              t.id === active
                ? 'bg-brand-primary text-white border-brand-primary font-bold'
                : 'bg-surface-panel text-ink-subtle border-surface-border hover:text-ink hover:border-accent-amber/60'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden p-2">
        {config ? (
          <MasterTable config={config} />
        ) : (
          <div className="text-2xs text-ink-muted p-4 text-center">
            🚧 「{MASTER_SUBTABS.find((t) => t.id === active)?.label}」マスタは A-10 の続編で実装予定です
          </div>
        )}
      </div>
    </div>
  );
}
