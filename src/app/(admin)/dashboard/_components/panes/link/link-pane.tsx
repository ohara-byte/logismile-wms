'use client';

/**
 * 🔌 基幹連携 タブ本体（A-11）
 *
 * モック準拠（管理用PCモック_v0.22.html L3045-3500 全体）。
 *
 * 構成:
 *   1. 連携ステータス バナー（5 カード）
 *   2. サブタブ（7 種、URL 同期 ?lsub=）
 *   3. アクティブな pane を描画
 */

import { useRouter, useSearchParams } from 'next/navigation';
import {
  DEFAULT_LINK_SUBTAB,
  LINK_SUBTABS,
  isLinkSubTabId,
  type LinkSubTabId,
} from './link-tabs-config';
import { LinkStatusBanner } from './link-status-banner';
import { LogPane } from './log-pane';

export function LinkPane() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('lsub');
  const active: LinkSubTabId = isLinkSubTabId(raw) ? raw : DEFAULT_LINK_SUBTAB;

  function go(id: LinkSubTabId) {
    const sp = new URLSearchParams(params.toString());
    sp.set('lsub', id);
    router.replace(`/dashboard?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col h-full p-2 gap-2">
      <LinkStatusBanner />

      {/* サブタブ */}
      <div className="grid grid-cols-7 gap-1">
        {LINK_SUBTABS.map((t) => (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            className={`p-1.5 rounded border text-left transition-colors ${
              t.id === active
                ? 'bg-blue-900 text-white border-brand-primary'
                : t.warn
                  ? 'bg-amber-950/30 border-amber-800 text-amber-100 hover:bg-amber-900'
                  : 'bg-surface-base border-surface-border text-ink-subtle hover:text-ink hover:border-accent-amber/60'
            }`}
          >
            <div className="flex items-start gap-1">
              <span className="text-base leading-none">{t.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold leading-tight">{t.main}</div>
                <div className="text-[9px] opacity-70 leading-tight truncate">{t.sub}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">{renderPane(active)}</div>
    </div>
  );
}

function renderPane(active: LinkSubTabId) {
  switch (active) {
    case 'log':
      return <LogPane />;
    case 'unmap':
      return (
        <PlaceholderPane
          title="⚠ 未マップ"
          desc="商品マスタ・顧客マスタに未登録の項目を一覧表示し、補助マスタへの追加を支援します"
          block="A-11b"
        />
      );
    case 'reimport':
      return (
        <PlaceholderPane
          title="🔄 手動再取込"
          desc="出荷指示 CSV / 商品マスタ CSV / 個別ピッキング№ の再取込"
          block="A-11b"
        />
      );
    case 'aux-prod':
    case 'aux-cust':
    case 'aux-carr':
    case 'aux-set':
      return (
        <PlaceholderPane
          title={LINK_SUBTABS.find((t) => t.id === active)?.main ?? ''}
          desc="補助マスタ。基幹側で持たない属性（外寸／温度帯／配送便コード等）を補完"
          block="A-11b"
        />
      );
  }
}

function PlaceholderPane({
  title,
  desc,
  block,
}: {
  title: string;
  desc: string;
  block: string;
}) {
  return (
    <div className="text-center py-8 px-4 text-2xs text-ink-muted">
      <div className="text-3xl mb-2 opacity-50">🚧</div>
      <h3 className="text-sm font-bold text-ink-strong mb-1">{title}</h3>
      <p className="text-2xs">{desc}</p>
      <p className="text-3xs mt-2">構築中（{block} で実装予定）</p>
    </div>
  );
}
