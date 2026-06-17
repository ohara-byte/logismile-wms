'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * 検品スキャンの速度計測表示の ON/OFF（端末ごと・localStorage 保持）。
 *  - 検品開始画面（ピッキング№入力）でトグル → 検品画面が読み取って、
 *    前回スキャンの所要時間（総時間／サーバ時間／通信時間）を画面に表示する。
 *  - chrome://inspect が現場で使いづらいため、devtools 無しで切り分けられるようにする。
 *  - 既定 OFF。useScanSound と同じ localStorage 方式。
 */
const STORAGE_KEY = 'inspect:perf-display';

export function usePerfDisplay(): { enabled: boolean; setEnabled: (next: boolean) => void } {
  const [enabled, setEnabledState] = useState<boolean>(false);

  // 初期値を localStorage から読み込み（クライアントのみ）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setEnabledState(window.localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      /* ignore */
    }
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  // 他画面（開始画面↔検品画面）での変更を同期
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setEnabledState(e.newValue === 'true');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { enabled, setEnabled };
}
