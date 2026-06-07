'use client';

/**
 * 在庫検品メニュー（Sprint Z-1）
 *
 * - 商品コード/JAN スキャンで対象 SKU を選択 → 検品画面へ遷移
 * - F2 で出荷検品（待機画面）に戻る
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useHardwareKeys } from '@/lib/use-hardware-keys';

export function StockMenu() {
  const router = useRouter();
  const [scanInput, setScanInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // F2 / F3 / Esc で出荷検品（待機画面）に戻る
  // Sprint Z-7: F3 トグル — ピッキング待機画面の F3=「在庫検品へ」と対称
  useHardwareKeys({
    onF2: () => router.push('/handy'),
    onF3: () => router.push('/handy'),
    onEscape: () => router.push('/handy'),
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = scanInput.trim();
    if (!value) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      // JAN または商品コードで Stock を検索
      const r = await fetch(`/api/stocks/${encodeURIComponent(value)}`);
      if (r.status === 404) {
        setErrorMsg(`該当商品が見つかりません: ${value}`);
        return;
      }
      if (!r.ok) {
        setErrorMsg(`エラー: HTTP ${r.status}`);
        return;
      }
      const j = await r.json();
      const productCode = j.data?.productCode as string | undefined;
      if (!productCode) {
        setErrorMsg('商品コードが取得できません');
        return;
      }
      router.push(`/handy/stock/count/${encodeURIComponent(productCode)}`);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="space-y-2">
        <label className="block text-3xs font-bold uppercase tracking-wider text-accent-amber mb-1">
          商品コード / JAN をスキャン
        </label>
        <input
          ref={inputRef}
          type="text"
          autoFocus
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          className="w-full bg-surface-panel border-2 border-accent-amber/50 rounded-lg px-3 py-3 text-lg font-mono text-ink-strong text-center tabular-nums focus:outline-none focus:border-accent-amber focus:ring-2 focus:ring-accent-amber/20"
          placeholder="2800001000027"
        />
        {errorMsg && (
          <div className="text-3xs text-status-error bg-status-error-bg border border-status-error/40 rounded p-2 text-center">
            {errorMsg}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !scanInput.trim()}
          className="w-full bg-blue-700 hover:bg-blue-600 text-white rounded-lg py-2.5 text-sm font-bold border border-blue-500 disabled:bg-surface-raised disabled:text-ink-muted disabled:border-surface-border"
        >
          {busy ? '検索中…' : '➡ 在庫検品開始'}
        </button>
      </form>

      <p className="text-3xs text-ink-muted text-center pt-1 leading-relaxed">
        ⌨ <b className="text-accent-amber">F3 / F2 / Esc</b> = 出荷検品メニューへ戻る
      </p>
    </div>
  );
}
