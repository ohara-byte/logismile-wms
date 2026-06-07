'use client';

/**
 * 検品スキャン音 / 完了音 共通フック（タブレット・ハンディ共用）
 *
 * 2026-05-23 新規:
 *   現場要望によりレジスター風の "ピッ" 音と検品完了時の達成感ある音階を実装。
 *
 * 設計方針:
 *   - Web Audio API で sine/square/sawtooth 波を合成し、音源ファイル不要
 *     （PWA オフライン動作にも親和的）
 *   - localStorage 'inspect:sound-enabled' で ON/OFF 状態を端末ごとに保持
 *   - iOS/Android のオートプレイ制限：window への user gesture を検出して
 *     AudioContext を resume（一度実行すれば以降の play が確実に発音する）
 *
 * 用途別パラメータ:
 *   playBeep    : matched / already_done 用。レジ風 "ピッ"
 *   playError   : over_scan / not_found 用。低音 "ブーッ"
 *   playSuccess : 検品完了時。C-E-G-C 上昇アルペジオ（達成感）
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'inspect:sound-enabled';

export interface ScanSound {
  /** スキャン成功時のレジ風 "ピッ" */
  playBeep: () => void;
  /** スキャンエラー時の "ブーッ" 低音 */
  playError: () => void;
  /** 検品完了時の C-E-G-C 上昇アルペジオ */
  playSuccess: () => void;
  /** 現在の ON/OFF 状態 */
  enabled: boolean;
  /** ON/OFF を切り替え（localStorage に保存） */
  setEnabled: (next: boolean) => void;
}

export function useScanSound(): ScanSound {
  const ctxRef = useRef<AudioContext | null>(null);
  const [enabled, setEnabledState] = useState<boolean>(true);

  // localStorage から初期値を読み込み（クライアントのみ）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'false') setEnabledState(false);
      else setEnabledState(true);
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

  // 他タブで設定が変わった時の同期
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setEnabledState(e.newValue !== 'false');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const getCtx = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!ctxRef.current) {
      type Win = Window & { webkitAudioContext?: typeof AudioContext };
      const w = window as Win;
      const Ctor = window.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return null;
      try {
        ctxRef.current = new Ctor();
      } catch {
        return null;
      }
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume().catch(() => {
        /* ignore */
      });
    }
    return ctxRef.current;
  }, []);

  // 初回 user gesture で AudioContext を解放（iOS/Android のオートプレイ制限対策）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      getCtx();
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, [getCtx]);

  // 任意の sin/square/sawtooth トーンを duration 秒鳴らす
  const playTone = useCallback(
    (
      freq: number,
      duration: number,
      type: OscillatorType = 'sine',
      volume: number = 0.25,
      startAt: number = 0,
    ) => {
      const ctx = getCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);

      const t0 = ctx.currentTime + startAt;
      // 開始時のクリック音を防ぐため軽くアタックさせ、終端でフェードアウト
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume, t0 + 0.005);
      gain.gain.setValueAtTime(volume, t0 + duration - 0.01);
      gain.gain.linearRampToValueAtTime(0, t0 + duration);

      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    },
    [getCtx],
  );

  const playBeep = useCallback(() => {
    if (!enabled) return;
    // レジスター風 "ピッ"：1200Hz square 80ms
    playTone(1200, 0.08, 'square', 0.22);
  }, [enabled, playTone]);

  const playError = useCallback(() => {
    if (!enabled) return;
    // エラー "ブーッ"：200Hz sawtooth 200ms（低く長く）
    playTone(200, 0.2, 'sawtooth', 0.28);
  }, [enabled, playTone]);

  const playSuccess = useCallback(() => {
    if (!enabled) return;
    // 達成感ある上昇アルペジオ C5 → E5 → G5 → C6
    const ctx = getCtx();
    if (!ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const noteDur = 0.15;
    notes.forEach((freq, i) => {
      playTone(freq, noteDur, 'sine', 0.25, i * 0.12);
    });
  }, [enabled, getCtx, playTone]);

  return { playBeep, playError, playSuccess, enabled, setEnabled };
}
