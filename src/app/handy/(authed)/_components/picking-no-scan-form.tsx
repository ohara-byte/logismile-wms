'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * ハンディ用ピッキング№入力フォーム
 *
 * KEYENCE BT-A500 はバーコード読み取り後に Enter キーを送信するので、
 * input への submit イベントだけで動作する。手入力にも対応。
 */
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

    router.push(`/handy/inspect/${encodeURIComponent(pkNo.trim())}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        type="text"
        autoFocus
        value={pkNo}
        onChange={(e) => setPkNo(e.target.value)}
        className="w-full border-2 rounded-lg px-3 py-3 text-base font-mono"
        placeholder="SA01208680006"
      />
      {errorMsg && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {errorMsg}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !pkNo.trim()}
        className="w-full bg-blue-600 text-white rounded-lg py-3 text-base font-medium hover:bg-blue-700 disabled:bg-gray-300"
      >
        {busy ? '読み込み中…' : '検品開始'}
      </button>
    </form>
  );
}
