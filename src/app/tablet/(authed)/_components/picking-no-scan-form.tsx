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

    // 存在確認（404 を即時に返す）
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
    <form onSubmit={onSubmit} className="space-y-4">
      <input
        type="text"
        autoFocus
        value={pkNo}
        onChange={(e) => setPkNo(e.target.value)}
        className="w-full border-2 rounded-lg px-4 py-4 text-xl font-mono"
        placeholder="SA01208680006"
      />
      {errorMsg && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {errorMsg}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !pkNo.trim()}
        className="w-full bg-blue-600 text-white rounded-lg py-4 text-lg font-medium hover:bg-blue-700 disabled:bg-gray-300"
      >
        {busy ? '読み込み中…' : '検品開始'}
      </button>
    </form>
  );
}
