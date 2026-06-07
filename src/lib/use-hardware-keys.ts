'use client';

/**
 * KEYENCE BT-A500 ハードウェアキー ブリッジフック（A-18）
 *
 * モック準拠（ハンディ検品モック_v0.14.html L2725-2767）。
 *
 * BT-A500 の物理キー（F1-F4 / 矢印 / Trigger / SideL/R / Vol / 数字 / Enter / Esc）を
 * 抽象化し、画面側のロジックハンドラに渡す。
 *
 * - input/textarea にフォーカスがある場合はキー処理しない
 * - Space → Trigger（実機の Trigger キーは Space を送ってくる想定）
 * - +/- → VolUp/VolDown（音量キー、現状未使用）
 *
 * 使い方:
 *   useHardwareKeys({
 *     onF1: () => ...,
 *     onF2: () => ...,
 *     onTrigger: () => ...,
 *     onEnter: () => ...,
 *     onEscape: () => ...,
 *     onUp/onDown/onLeft/onRight: () => ...,
 *     onDigit: (d) => ...,
 *     onBackspace/onClear,
 *     enabled: boolean (default true) — モーダル中は false にできる
 *   });
 */

import { useEffect } from 'react';

export interface HardwareKeyHandlers {
  onF1?: () => void;
  onF2?: () => void;
  onF3?: () => void;
  onF4?: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  onEnter?: () => void;
  onEscape?: () => void;
  onTab?: () => void;
  onTrigger?: () => void;
  onDigit?: (d: number) => void;
  onBackspace?: () => void;
  onClear?: () => void;
  /** 全体無効化（既存モーダルが完全制御している場合等） */
  enabled?: boolean;
}

export function useHardwareKeys(handlers: HardwareKeyHandlers) {
  useEffect(() => {
    if (handlers.enabled === false) return;

    function onKey(e: KeyboardEvent) {
      const t = e.target as Element | null;
      // input / textarea / contentEditable にフォーカス中か判定
      // ※ハンディはスキャン入力に常時フォーカスがある運用のため、
      //   F1-F4 / Escape / Tab は input フォーカス中でも常に発火させる。
      const inEditable =
        !!t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          (t as HTMLElement).isContentEditable);

      // F1-F4（input フォーカスに関わらず常に発火 — 物理ファンクションキー扱い）
      if (/^F[1-4]$/.test(e.key)) {
        const fn = (
          {
            F1: handlers.onF1,
            F2: handlers.onF2,
            F3: handlers.onF3,
            F4: handlers.onF4,
          } as Record<string, undefined | (() => void)>
        )[e.key];
        if (fn) {
          e.preventDefault();
          fn();
        }
        return;
      }

      // Escape / Tab は input フォーカス中でも発火（保留メニュー / 行ナビ用）
      if (e.key === 'Escape') {
        if (handlers.onEscape) {
          e.preventDefault();
          handlers.onEscape();
        }
        return;
      }
      if (e.key === 'Tab') {
        if (handlers.onTab) {
          e.preventDefault();
          handlers.onTab();
        }
        return;
      }

      // 以下のキー（文字入力に重なるもの）は input フォーカス中はスルー
      if (inEditable) return;

      // 矢印キー
      switch (e.key) {
        case 'ArrowUp':
          if (handlers.onUp) {
            e.preventDefault();
            handlers.onUp();
          }
          return;
        case 'ArrowDown':
          if (handlers.onDown) {
            e.preventDefault();
            handlers.onDown();
          }
          return;
        case 'ArrowLeft':
          if (handlers.onLeft) {
            e.preventDefault();
            handlers.onLeft();
          }
          return;
        case 'ArrowRight':
          if (handlers.onRight) {
            e.preventDefault();
            handlers.onRight();
          }
          return;
        case 'Enter':
          if (handlers.onEnter) {
            e.preventDefault();
            handlers.onEnter();
          }
          return;
        case 'Backspace':
          if (handlers.onBackspace) {
            e.preventDefault();
            handlers.onBackspace();
          }
          return;
        case 'Delete':
          if (handlers.onClear) {
            e.preventDefault();
            handlers.onClear();
          }
          return;
        case ' ':
          // BT-A500 Trigger キーは Space を送る想定
          if (handlers.onTrigger) {
            e.preventDefault();
            handlers.onTrigger();
          }
          return;
      }

      // 0-9 数字
      if (/^[0-9]$/.test(e.key) && handlers.onDigit) {
        e.preventDefault();
        handlers.onDigit(parseInt(e.key, 10));
        return;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    handlers.enabled,
    handlers.onF1,
    handlers.onF2,
    handlers.onF3,
    handlers.onF4,
    handlers.onUp,
    handlers.onDown,
    handlers.onLeft,
    handlers.onRight,
    handlers.onEnter,
    handlers.onEscape,
    handlers.onTab,
    handlers.onTrigger,
    handlers.onDigit,
    handlers.onBackspace,
    handlers.onClear,
  ]);
}
