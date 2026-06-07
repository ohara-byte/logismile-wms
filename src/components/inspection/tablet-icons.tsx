/**
 * タブレット検品モック_v0.18.html のフッタボタン SVG アイコン群（モック L1266-1271 準拠）。
 * すべて 24x24 viewBox、`currentColor` 描画、デフォルト 22x22 表示。
 *
 * 使用例:
 *   <BarcodeIcon size={22} />
 */

import type { SVGProps } from 'react';

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function base(size?: number, rest?: SVGProps<SVGSVGElement>) {
  return {
    viewBox: '0 0 24 24',
    width: size ?? 22,
    height: size ?? 22,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };
}

/** 商品スキャン（バーコード縦線） */
export function BarcodeIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <path d="M3 5v14M6.5 5v14M10 5v14M14 5v14M17.5 5v14M21 5v14" />
    </svg>
  );
}

/** 強制OK（盾＋チェック） */
export function ShieldCheckIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <path d="M12 2L4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

/** 同梱物（箱・3D） */
export function BoxIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3.27 6.96L12 12l8.73-5.04M12 22V12" />
    </svg>
  );
}

/** 一括検品（クリップボード＋チェック） */
export function ClipboardCheckIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <rect x="6" y="4" width="12" height="16" rx="2" />
      <path d="M9 4V3a1 1 0 011-1h4a1 1 0 011 1v1" />
      <path d="M9 13l2 2 4-4" />
    </svg>
  );
}

/** 伝票保留（ブックマーク） */
export function BookmarkIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
    </svg>
  );
}

/** 中断（左矢印） */
export function ArrowLeftIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

/** 印刷（プリンタ）— QR印刷フラグ etc */
export function PrinterIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}
