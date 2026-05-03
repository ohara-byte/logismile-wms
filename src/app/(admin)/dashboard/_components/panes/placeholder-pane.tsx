'use client';

/**
 * 未実装タブ用のプレースホルダ pane
 * Sprint A-04 以降で本物のコンポーネントに置き換える。
 */

import Link from 'next/link';

interface Props {
  title: string;
  block: string;
  /** 一時的に既存ページへ誘導したい場合のリンク */
  legacyHref?: string;
  legacyLabel?: string;
}

export function PlaceholderPane({ title, block, legacyHref, legacyLabel }: Props) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="text-4xl mb-3 opacity-60">🚧</div>
      <h3 className="text-base font-bold text-ink-strong mb-1">{title}</h3>
      <p className="text-2xs text-ink-muted mb-1">構築中（{block} で実装予定）</p>
      <p className="text-3xs text-ink-muted max-w-xs">
        モック準拠の挙動とデータ連携を順次組み込みます。
      </p>
      {legacyHref && (
        <Link
          href={legacyHref}
          className="mt-4 text-2xs text-status-info hover:underline"
        >
          {legacyLabel ?? '従来画面へ'} →
        </Link>
      )}
    </div>
  );
}
