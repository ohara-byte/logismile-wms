'use client';

/**
 * 未読連絡のポーリング（タブレット・ハンディ共用）
 *
 * 2026-08-09 新規:
 *   従来 `NoticesModal` はマウント時に 1 回だけ取得していたため、
 *   管理 PC から送った連絡は「次の伝票に移るまで届かない」状態だった。
 *   保留指示・中止のように現場を止める必要がある連絡が遅れるため、
 *   端末側で定期取得し、緊急度に応じて割り込ませる。
 *
 * 方式:
 *   15 秒間隔のクライアントポーリング。SSE ではなくポーリングにしたのは
 *     - `/api/progress/stream` が admin/manager 限定でモバイルから使えない
 *     - そもそも同 SSE 自体がサーバ側 5 秒ポーリングの「擬似 SSE」
 *     - 端末 15 台 × 15 秒 ≒ 1 req/s で負荷が問題にならない
 *   ため。既存の `GET /api/notices?unread=true` をそのまま使い、API は増やさない。
 *
 * 緊急度:
 *   priority >= URGENT_PRIORITY(90) を「検品中でも割り込む」連絡として扱う。
 *   管理 PC 側の送信 UI（order-detail-modal.tsx）と対応している。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notice } from '@/components/inspection/notices-modal';

/** これ以上の priority は検品中でも即ポップアップする。 */
export const URGENT_PRIORITY = 90;

const DEFAULT_INTERVAL_MS = 15_000;

export interface NoticePoll {
  /** 未読の連絡（宛先フィルタ済み。サーバ側で判定） */
  notices: Notice[];
  /** うち緊急（priority >= 90） */
  urgent: Notice[];
  /** 未読件数 */
  unreadCount: number;
  /** 即時に取り直す */
  refresh: () => void;
}

export function useNoticePoll(opts?: {
  intervalMs?: number;
  /** false の間はポーリングを止める（モーダル表示中など） */
  enabled?: boolean;
}): NoticePoll {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const enabled = opts?.enabled ?? true;
  const [notices, setNotices] = useState<Notice[]>([]);
  /** 多重リクエスト防止（低速回線でポーリングが重なるのを避ける） */
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch('/api/notices?unread=true');
      if (!r.ok) return;
      const j = await r.json();
      setNotices(j.data?.items ?? []);
    } catch {
      /* 通信断はスキップ（次の周期で復帰する） */
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => {
      // バックグラウンドのタブでは叩かない（端末が伏せられている間の無駄打ち防止）
      if (document.visibilityState === 'hidden') return;
      void refresh();
    }, intervalMs);
    // 画面に復帰したら即座に取り直す
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs, refresh]);

  return {
    notices,
    urgent: notices.filter((n) => n.priority >= URGENT_PRIORITY),
    unreadCount: notices.length,
    refresh,
  };
}
