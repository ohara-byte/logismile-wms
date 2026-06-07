/**
 * /tablet 配下の全ページ共通レイアウト
 *
 * 2026-05-20: タブレット PWA 化
 *   - manifest をタブレット用に切替（display: standalone、起動 URL /tablet/login）
 *   - Service Worker 登録（インストール可能化）
 *   - viewport は user-scalable=no（誤拡大防止）
 *
 * インストール手順：
 *   タブレット Chrome で http://192.168.1.139:3000/tablet を開く
 *     → ⋮ メニュー → 「ホーム画面に追加」
 *     → ホーム画面のアイコンをタップで全画面起動
 */

import type { Metadata, Viewport } from 'next';
import { PwaServiceWorker } from './_components/pwa-service-worker';

export const metadata: Metadata = {
  title: 'LogiSmile タブレット検品',
  description: 'LogiSmile タブレット検品アプリ',
  manifest: '/tablet-manifest.webmanifest',
  // iOS Safari でも「ホーム画面に追加」したときアプリ風に動作させる
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LS タブレット',
    startupImage: ['/icon-tablet-512.png'],
  },
  icons: {
    icon: [
      { url: '/icon-tablet-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-tablet-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-icon-tablet.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#29A6F6',
  // 端末のノッチ等の対応（CSS env(safe-area-inset-*) を利用可能に）
  viewportFit: 'cover',
};

export default function TabletRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* localStorage "tablet:portrait" の値（true=縦 / false=横）で
          PWA 起動時に screen.orientation.lock() を試みる。 */}
      <PwaServiceWorker lockOrientationFromStorage="tablet:portrait" />
      {children}
    </>
  );
}
