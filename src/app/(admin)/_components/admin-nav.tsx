'use client';

/**
 * 管理PC ヘッダのナビゲーション
 *
 * 業務 / 計画 / データ の 3 グループに分けて表示。
 * 現在のパスを usePathname で取得して active 状態をハイライトする。
 */

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

interface NavGroup {
  label: string;
  items: { href: string; label: string; icon: string }[];
}

interface Props {
  groups: NavGroup[];
}

export function AdminNav({ groups }: Props) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 flex items-center gap-3 overflow-x-auto">
      {groups.map((g, gi) => (
        <div key={g.label} className="flex items-center gap-0.5">
          {gi > 0 && <div className="w-px h-6 bg-surface-border mr-1" />}
          <span className="text-3xs text-ink-muted uppercase tracking-wider mr-1.5 hidden xl:inline">
            {g.label}
          </span>
          {g.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <a
                key={item.href}
                href={item.href}
                className={cn(
                  'px-2.5 py-1.5 rounded text-sm transition-colors flex items-center gap-1.5 whitespace-nowrap',
                  active
                    ? 'bg-surface-panel text-accent-amber font-bold'
                    : 'text-ink-subtle hover:text-ink-strong hover:bg-surface-panel',
                )}
              >
                <span className="text-base">{item.icon}</span>
                <span className="hidden md:inline">{item.label}</span>
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
