'use client';

/**
 * 管理 PC ナビバッジ Context
 *
 * SSE 経由で push される件数と接続状態を全タブ・KPI チップに配信する。
 *
 * 提供 API:
 *   useBadges()   … { counts, connected, refresh() }
 *
 * 接続失敗時は EventSource 既定の自動再接続に任せる。
 * 初期値は /api/admin/badges から REST で取得し、SSE が未接続でも
 * 表示が固まらないようにする。
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ZERO_BADGES,
  type BadgeCounts,
} from '@/lib/dashboard/badges-types';

interface BadgeContextValue {
  counts: BadgeCounts;
  connected: boolean;
  /** 手動で REST 経由で再取得 */
  refresh: () => Promise<void>;
}

const Ctx = createContext<BadgeContextValue>({
  counts: ZERO_BADGES,
  connected: false,
  refresh: async () => {},
});

export function useBadges(): BadgeContextValue {
  return useContext(Ctx);
}

export function BadgeProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<BadgeCounts>(ZERO_BADGES);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  async function refresh() {
    try {
      const r = await fetch('/api/admin/badges');
      if (!r.ok) return;
      const j = await r.json();
      if (j?.data) setCounts(j.data as BadgeCounts);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    let aborted = false;

    // 初期 REST 取得（SSE が立ち上がるまでの空白を埋める）
    refresh();

    // SSE 接続
    const es = new EventSource('/api/progress/stream');
    esRef.current = es;

    es.addEventListener('open', () => {
      if (!aborted) setConnected(true);
    });

    es.addEventListener('error', () => {
      if (!aborted) setConnected(false);
      // EventSource は自動再接続するのでここでは閉じない
    });

    es.addEventListener('init', (ev) => {
      if (aborted) return;
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        setCounts(data as BadgeCounts);
        setConnected(true);
      } catch {
        /* ignore */
      }
    });

    es.addEventListener('badge', (ev) => {
      if (aborted) return;
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        setCounts(data as BadgeCounts);
      } catch {
        /* ignore */
      }
    });

    return () => {
      aborted = true;
      es.close();
      esRef.current = null;
    };
  }, []);

  return (
    <Ctx.Provider value={{ counts, connected, refresh }}>{children}</Ctx.Provider>
  );
}
