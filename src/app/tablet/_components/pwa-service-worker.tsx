'use client';

/**
 * Service Worker 登録 + 画面回転ロック（タブレット PWA 専用）
 *
 * 2026-05-20 PWA 化のため新設。
 *
 * Service Worker:
 *   - /sw.js を登録（最小限の passthrough SW）
 *   - PWA インストール条件のひとつである SW を満たす
 *   - 既に登録済の場合はスキップ
 *
 * 画面回転ロック（タブレットのみ。ハンディは manifest で portrait 固定済）:
 *   - localStorage の "tablet:portrait" に従い、縦 or 横でロック
 *   - PWA standalone モードで動作（通常のブラウザタブでは失敗するが致命ではない）
 *   - ユーザーがインスペクション画面でトグルすると次回起動時に追従
 */

import { useEffect } from 'react';

interface OrientationWithLock extends ScreenOrientation {
  lock?: (
    orientation:
      | 'any'
      | 'natural'
      | 'landscape'
      | 'portrait'
      | 'portrait-primary'
      | 'portrait-secondary'
      | 'landscape-primary'
      | 'landscape-secondary',
  ) => Promise<void>;
}

export function PwaServiceWorker({
  lockOrientationFromStorage,
}: {
  /** "tablet:portrait" などの localStorage キー。未指定なら回転ロックしない */
  lockOrientationFromStorage?: string;
} = {}) {
  // Service Worker 登録
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const timer = setTimeout(() => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  // 画面回転ロック（タブレット用、localStorage 値があれば固定）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!lockOrientationFromStorage) return;

    const tryLock = () => {
      try {
        const pref = localStorage.getItem(lockOrientationFromStorage);
        if (pref !== 'true' && pref !== 'false') return; // 未設定なら自由
        const target: 'portrait' | 'landscape' =
          pref === 'true' ? 'portrait' : 'landscape';
        const o = screen.orientation as OrientationWithLock | undefined;
        if (!o || !o.lock) return;
        o.lock(target).catch(() => {
          // ロック失敗（standalone モード外など）は無視
        });
      } catch {
        // localStorage が使えない / その他失敗
      }
    };

    // PWA 起動直後は visibility が安定しないため、ちょっと遅らせる
    const t = setTimeout(tryLock, 300);

    // 設定が変わった（別タブで localStorage を変更した等）ら追従
    const onStorage = (e: StorageEvent) => {
      if (e.key === lockOrientationFromStorage) tryLock();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      clearTimeout(t);
      window.removeEventListener('storage', onStorage);
    };
  }, [lockOrientationFromStorage]);

  return null;
}
