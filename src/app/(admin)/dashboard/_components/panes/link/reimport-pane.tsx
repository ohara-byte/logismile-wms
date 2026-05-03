'use client';

/**
 * 🔄 手動再取込 サブタブ（A-11b）
 *
 * モック準拠 簡易版:
 *  - 既存 /imports ページへ誘導するカード（出荷指示 / 商品マスタ）
 *  - 個別ピッキング№ 再取込（POST /api/orders/import を使う想定だが、
 *    現状 API 未対応のため 案内のみ）
 */

import Link from 'next/link';

export function ReimportPane() {
  return (
    <div className="p-2 space-y-3">
      <div className="text-2xs text-ink-subtle leading-snug">
        Thomas からの CSV ファイルを手動で取り込み直します。
        標準は 1 日 5〜10 回の都度取込（現状は手動アップロード方式）。
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Card
          icon="📦"
          title="出荷指示 CSV"
          desc="基幹側の出荷指示データを再取込します。同一ピッキング№は重複エラー扱い。"
          href="/imports"
          buttonLabel="📁 取込画面へ"
        />
        <Card
          icon="🥚"
          title="商品マスタ CSV"
          desc="商品名・JAN・カテゴリ・梱包単位等を更新します。差分のみ反映。"
          href="/imports"
          buttonLabel="📁 取込画面へ"
        />
      </div>

      <div className="bg-surface-base border border-surface-border rounded p-3">
        <div className="text-xs font-bold text-ink-strong mb-1">
          🔄 個別ピッキング№ 再取込（将来実装）
        </div>
        <div className="text-2xs text-ink-muted leading-snug">
          特定の伝票だけを基幹からプル取込する機能は将来ブロックで実装予定です。
          現状は CSV 全件再取込でカバー（重複ピッキング№はスキップ）。
        </div>
      </div>

      <div className="bg-blue-950/30 border border-blue-800 rounded p-3 text-2xs text-blue-100">
        💡 自動定期取込（例: 2 時間ごと）は `IFアダプタ層` の API 化 (Phase 2) で対応予定。
        現状は管理 PC からの手動取込のみ。
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  desc,
  href,
  buttonLabel,
}: {
  icon: string;
  title: string;
  desc: string;
  href: string;
  buttonLabel: string;
}) {
  return (
    <div className="bg-surface-base border border-surface-border rounded p-3">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-xs font-bold text-ink-strong mb-1">{title}</div>
      <p className="text-2xs text-ink-muted leading-snug mb-2">{desc}</p>
      <Link
        href={href}
        className="inline-block text-2xs px-2 py-1 rounded bg-brand-primary text-white font-bold hover:bg-blue-600"
      >
        {buttonLabel}
      </Link>
    </div>
  );
}
