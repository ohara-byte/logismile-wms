'use client';

/**
 * 画面回転ロック（タブレット検品用）
 *
 * 不具合対応：HP14 タブレットで縦持ち作業中、スキャンの瞬間に
 * 横向きへ自動回転してしまうことがあるため、最初のユーザー操作で
 *  1. 全画面モードへ移行（Screen Orientation API は fullscreen 必須）
 *  2. その瞬間の orientation で screen.orientation.lock() を呼ぶ
 * という二段構えで画面を固定する。
 *
 * 仕組み:
 *  - マウント時に「📱 画面ロック」バナーを表示
 *  - ユーザーが画面のどこかをタッチ／クリックした最初の 1 回で
 *    全画面 + 回転ロックを試行
 *  - ロック成功でバナー消滅。失敗時はバナーに再試行ボタン表示
 *  - 全画面が外れた / orientation が変化した場合は自動で再ロック
 *
 * 注意:
 *  - Chrome / Edge は fullscreen 内で screen.orientation.lock を許可
 *  - iOS Safari は orientation lock 非対応（実機が Windows タブレットのため許容）
 *  - login 画面には適用しない（(authed) layout 配下のみ）
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type LockState = 'pending' | 'locked' | 'error';

// Screen Orientation API の型補強（一部ブラウザで型定義が古い）
interface OrientationWithLock extends ScreenOrientation {
  lock?: (orientation: OrientationLockType) => Promise<void>;
}
type OrientationLockType =
  | 'any'
  | 'natural'
  | 'landscape'
  | 'portrait'
  | 'portrait-primary'
  | 'portrait-secondary'
  | 'landscape-primary'
  | 'landscape-secondary';

export function OrientationLock() {
  const [state, setState] = useState<LockState>('pending');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // ユーザー操作で一度ロックを試みたか
  const triedRef = useRef(false);

  /** 現在の orientation を読み取り、それを固定対象として lock を試みる */
  const tryLock = useCallback(async () => {
    triedRef.current = true;
    setErrMsg(null);

    try {
      // 既に全画面なら fullscreen 要求を省略
      const doc = document.documentElement;
      const isFullscreen = !!document.fullscreenElement;
      if (!isFullscreen && doc.requestFullscreen) {
        await doc.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
          // fullscreen が拒否されても orientation.lock を試す価値はある
        });
      }

      const o = (screen.orientation as OrientationWithLock) ?? null;
      if (!o || !o.lock) {
        throw new Error('このブラウザは画面回転ロックに対応していません');
      }

      // 現在の orientation を保持
      //   portrait-primary / portrait-secondary / landscape-* のいずれか
      //   そのまま渡すと「現在の向きで固定」になる
      const current = o.type as OrientationLockType;
      await o.lock(current);
      setState('locked');
    } catch (e) {
      setState('error');
      setErrMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 初回マウント時、ユーザー操作（タッチ／クリック）の最初の 1 回で lock を発火
  useEffect(() => {
    if (state === 'locked') return;

    const onFirstInteraction = () => {
      if (triedRef.current) return;
      tryLock();
    };
    window.addEventListener('pointerdown', onFirstInteraction, {
      once: true,
      passive: true,
    });
    window.addEventListener('keydown', onFirstInteraction, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    };
  }, [state, tryLock]);

  // 全画面が外れたら再度ロックを試みる（タブレット側の戻る操作対策）
  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement) {
        // 全画面解除されたので再ロック対象に戻す
        triedRef.current = false;
        setState('pending');
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // orientation が変化したら、新しい向きで再ロックを試みる
  //   （ロック前に物理回転されたケース対応）
  useEffect(() => {
    function onOrientationChange() {
      if (state === 'locked') {
        // 既にロック済なら lock 解除されてしまった可能性 → 再ロック
        triedRef.current = false;
        setState('pending');
      }
    }
    window.addEventListener('orientationchange', onOrientationChange);
    return () =>
      window.removeEventListener('orientationchange', onOrientationChange);
  }, [state]);

  // ロック成功時はバナー非表示
  if (state === 'locked') return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] bg-amber-600 text-white text-center py-1.5 px-3 text-xs font-bold shadow-lg flex items-center justify-center gap-2"
      role="status"
      aria-live="polite"
    >
      {state === 'pending' && (
        <>
          <span>📱 画面ロック未設定 — 画面を 1 回タップして固定してください</span>
          <button
            type="button"
            onClick={tryLock}
            className="bg-white/20 hover:bg-white/30 rounded px-2 py-0.5 text-xs"
          >
            今すぐ固定
          </button>
        </>
      )}
      {state === 'error' && (
        <>
          <span>⚠ 画面ロックに失敗：{errMsg ?? '不明なエラー'}</span>
          <button
            type="button"
            onClick={tryLock}
            className="bg-white/20 hover:bg-white/30 rounded px-2 py-0.5 text-xs"
          >
            再試行
          </button>
        </>
      )}
    </div>
  );
}
