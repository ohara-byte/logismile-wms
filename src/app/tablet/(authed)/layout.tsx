/**
 * /tablet/(authed) — 社員番号セッション必須
 *
 * /tablet/login は (authed) グループの外なのでこのレイアウトは適用されない。
 *
 * 画面回転対策：
 *   - 旧版で導入した OrientationLock（全画面+Screen Orientation API ロック）は
 *     fullscreen 化の副作用でスキャン input のフォーカスを奪う問題があったため撤去。
 *   - 真の不具合「遷移後に縦横レイアウトが切替わる」は
 *     tablet-inspection-screen 側で `portrait` state を画面サイズから自動判定
 *     + localStorage 保持に変更して解消済み。
 *   - 物理回転は Windows のアクションセンター「回転ロック」を利用してください。
 */

import { redirect } from 'next/navigation';
import { getEmployeeSession } from '@/lib/auth/employee-session';

export default async function TabletAuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getEmployeeSession();
  if (!session) redirect('/tablet/login');
  return <>{children}</>;
}
