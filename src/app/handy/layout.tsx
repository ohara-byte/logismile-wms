/**
 * /handy 配下の全ページ共通レイアウト
 *
 * 2026-05-20: ハンディ PWA 化
 *   - manifest をハンディ用に切替（display: fullscreen、縦固定、起動 URL /handy/login）
 *   - Service Worker 登録（インストール可能化）
 *
 * インストール手順：
 *   ハンディ（KEYENCE BT-A500 等）Chrome で http://192.168.1.139:3000/handy を開く
 *     → ⋮ メニュー → 「ホーム画面に追加」
 *     → ホーム画面のアイコンをタップで全画面起動（縦固定）
 */

import type { Metadata, Viewport } from 'next';
import { PwaServiceWorker } from '../tablet/_components/pwa-service-worker';

export const metadata: Metadata = {
  title: 'LogiSmile ハンディ検品',
  description: 'LogiSmile ハンディ検品アプリ（KEYENCE BT-A500 専用）',
  manifest: '/handy-manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LS ハンディ',
    startupImage: ['/icon-handy-512.png'],
  },
  icons: {
    icon: [
      { url: '/icon-handy-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-handy-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-icon-handy.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#29A6F6',
  viewportFit: 'cover',
};

export default function HandyRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PwaServiceWorker />
      {children}
    </>
  );
}
