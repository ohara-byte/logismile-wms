/**
 * 管理 PC ナビバッジの型定義（クライアントから import 可能）
 *
 * 実装本体（DB 集計）は ./badges.ts。
 * client / server 双方で使う型と純粋関数だけをここに置く。
 */

export interface BadgeCounts {
  alerts: number;
  force: number;
  ann: number;
  link: number;
  match: number;
}

export const ZERO_BADGES: BadgeCounts = {
  alerts: 0,
  force: 0,
  ann: 0,
  link: 0,
  match: 0,
};

export function badgesEqual(a: BadgeCounts, b: BadgeCounts): boolean {
  return (
    a.alerts === b.alerts &&
    a.force === b.force &&
    a.ann === b.ann &&
    a.link === b.link &&
    a.match === b.match
  );
}
