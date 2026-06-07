/**
 * 🛠 設定ページ（Sprint Z-7）
 *
 * 管理者・マネージャー専用の運用ツール画面：
 *  - ログイン強制解除（連続失敗で一時ロックされたアカウントの解除）
 *  - アクティブ検品セッションの強制終了（フリーズ復旧）
 *  - 在庫整合性チェック / 再計算
 *  - システム情報（DRY-RUN フラグ等）
 *
 * 当初は右ペインのタブとして実装したが、
 * 「タブが多すぎて見えなくなる」問題のため独立ページに昇格（Z-7）。
 * ヘッダーの「プリンタ試刷」隣の「🛠 設定」リンクから到達する。
 */

import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/auth-options';
import { SettingsPane } from '../dashboard/_components/panes/settings-pane';

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }
  // Sprint Y-13: 管理者(admin) のみアクセス可（manager 不可）
  const role = session.user.role;
  if (role !== 'admin') {
    redirect('/dashboard');
  }

  return (
    // Sprint Y-10: 設定ページのみライトテーマ（白背景 + ハーフトーン → 100%）
    <div className="settings-light min-h-[calc(100vh-4rem)]">
      <div className="max-w-[1920px] mx-auto p-3">
        <div className="mb-3">
          <h1 className="text-lg font-bold text-ink-strong">🛠 システム設定</h1>
          <p className="text-2xs text-ink-muted">
            管理者(admin)専用 — ログインロック解除 / セッション復旧 / 在庫整合性 / 権限マトリクス / システム情報
          </p>
        </div>
        <SettingsPane />
      </div>
    </div>
  );
}
