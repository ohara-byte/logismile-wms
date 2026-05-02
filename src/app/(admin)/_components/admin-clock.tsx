'use client';

import { useEffect, useState } from 'react';

/** ヘッダ右側の時計（秒まで表示、1秒更新） */
export function AdminClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    return (
      <div className="hidden lg:flex flex-col items-end leading-tight">
        <span className="text-xs text-ink-muted font-mono">--:--:--</span>
        <span className="text-3xs text-ink-muted">----/--/--</span>
      </div>
    );
  }

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const date = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const wd = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];

  return (
    <div className="hidden lg:flex flex-col items-end leading-tight">
      <span className="text-sm text-accent-amber font-mono font-bold tabular-nums">
        {hh}:{mm}:{ss}
      </span>
      <span className="text-3xs text-ink-muted">
        {date} ({wd})
      </span>
    </div>
  );
}
