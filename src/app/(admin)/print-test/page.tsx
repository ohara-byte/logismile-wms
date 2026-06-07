/**
 * 🖨 プリンタ試刷ページ
 *
 * 管理 PC からプリンタ動作を確認するための独立ページ。
 *  - プリンタマスタから 1 台選択
 *  - 任意の納品書№/ピッキング№（試刷値）を入力
 *  - 「試刷を実行」で /api/print/qr/test を呼出
 *  - 直近のテスト印刷ログを表示
 *
 * モック非依存のテスト用 UI（実機調整 Phase 6 で本仕様化）
 */

import { PrinterTestClient } from './_components/printer-test-client';

export const metadata = {
  title: 'プリンタ試刷',
};

export default async function PrintTestPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-ink-strong mb-1">
        🖨 プリンタ試刷（QR ラベル）
      </h1>
      <p className="text-2xs text-ink-muted mb-4">
        SCeaTa CT4-LX への動作確認用。30×40mm の QR ラベルを 1 枚発行します。
        実機未接続時は <b>DRY-RUN</b> として記録のみ行われます（環境変数{' '}
        <code className="px-1 py-0.5 bg-surface-base rounded text-ink">
          PRINTER_DRY_RUN=false
        </code>{' '}
        で実機送信に切替）。
      </p>
      <PrinterTestClient />
    </main>
  );
}
