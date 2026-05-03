/**
 * 管理PC のナビゲーション構成（タブグループ）
 *
 *   業務 (現場運用)        : ダッシュボード / 出荷指示 / 連絡事項
 *   計画 (人員・割当)      : シフト / 割当
 *   データ (基幹連携・分析) : CSV取込 / レポート
 */

export const NAV_GROUPS: {
  label: string;
  items: { href: string; label: string; icon: string }[];
}[] = [
  {
    label: '業務',
    items: [
      { href: '/dashboard', label: 'ダッシュボード', icon: '📊' },
      { href: '/orders', label: '出荷指示', icon: '📦' },
      { href: '/notices', label: '連絡事項', icon: '📢' },
    ],
  },
  {
    label: '計画',
    items: [
      { href: '/shift', label: 'シフト', icon: '📅' },
      { href: '/assignment', label: '割当', icon: '👥' },
    ],
  },
  {
    label: 'データ',
    items: [
      { href: '/imports', label: 'CSV取込', icon: '📥' },
      { href: '/reports', label: 'レポート', icon: '📈' },
    ],
  },
];
