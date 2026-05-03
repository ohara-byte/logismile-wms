'use client';

/**
 * 強制OK Sticky モード（モック準拠 タブレット検品モック_v0.18.html L1285-1293）
 *
 * 検品担当が「次の伝票以降も継続」にチェックを入れて強制OKを実行すると、
 * 以降の伝票でも同じ理由コードで自動的に強制OK にできるモード。
 * sessionStorage で端末ローカルに保持し、ブラウザを閉じても残る（手動解除まで）。
 *
 * 解除は画面上部のバナー右側の「解除」ボタンから。
 */

import { useCallback, useEffect, useState } from 'react';
import type { ForceReasonCode } from './force-ok';

const STORAGE_KEY = 'wms.sticky-force-ok';

interface StickyState {
  code: ForceReasonCode;
  reason: string;
  startedAt: string;
}

export function useStickyForceOk() {
  const [state, setState] = useState<StickyState | null>(null);

  // 起動時に sessionStorage から復元
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const activate = useCallback((code: ForceReasonCode, reason: string) => {
    const next: StickyState = { code, reason, startedAt: new Date().toISOString() };
    setState(next);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const deactivate = useCallback(() => {
    setState(null);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return {
    /** Sticky モードが有効か */
    active: state !== null,
    /** 現在の理由コード */
    code: state?.code ?? null,
    /** 現在の理由テキスト（ログ送信用） */
    reason: state?.reason ?? null,
    /** Sticky 開始時刻 */
    startedAt: state?.startedAt ?? null,
    activate,
    deactivate,
  };
}
