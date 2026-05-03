'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function PickingNoScanForm() {
  const router = useRouter();
  const [pkNo, setPkNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pkNo.trim()) return;
    setBusy(true);
    setErrorMsg(null);

    const res = await fetch(`/api/orders/${encodeURIComponent(pkNo.trim())}`);
    if (res.status === 404) {
      setErrorMsg('該当する出荷指示が見つかりません');
      setBusy(false);
      return;
    }
    if (!res.ok) {
      setErrorMsg(`エラー: HTTP ${res.status}`);
      setBusy(false);
      return;
    }

    router.push(`/tablet/inspect/${encodeURIComponent(pkNo.trim())}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        type="text"
        autoFocus
        value={pkNo}
        onChange={(e) => setPkNo(e.target.value)}
        className="w-full bg-surface-panel border-2 border-accent-amber/50 rounded-lg px-4 py-4 text-2xl font-mono text-ink-strong text-center tabular-nums focus:outline-none focus:border-accent-amber focus:ring-4 focus:ring-accent-amber/20"
        placeholder="SA01208680006"
      />
      {errorMsg && (
        <div className="text-xs text-status-error bg-status-error-bg border border-status-error/40 rounded p-2.5 text-center">
          {errorMsg}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !pkNo.trim()}
        className="w-full bg-blue-700 hover:bg-blue-600 text-white rounded-lg py-3 text-base font-bold border border-blue-500 disabled:bg-surface-raised disabled:text-ink-muted disabled:border-surface-border"
      >
        {busy ? '読み込み中…' : '検品開始'}
      </button>
    </form>
  );
}
