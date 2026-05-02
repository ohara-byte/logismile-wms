import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'LogiSmile — 大江ノ郷自然牧場 倉庫管理システム',
  description: '大江ノ郷自然牧場の倉庫管理システム LogiSmile',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="font-sans antialiased bg-surface-base text-ink min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
