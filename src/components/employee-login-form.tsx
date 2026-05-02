'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  /** モバイル端末種別。ログイン後の遷移先と画面文言を切り替え。 */
  variant: 'tablet' | 'handy';
}

const VARIANT_CONFIG = {
  tablet: {
    title: 'タブレット検品 ログイン',
    description: 'HP14 タブレットで使用',
    deviceCodePlaceholder: 'TBL-01',
    redirectTo: '/tablet',
  },
  handy: {
    title: 'ハンディ検品 ログイン',
    description: 'KEYENCE BT-A500 で使用',
    deviceCodePlaceholder: 'HDY-01',
    redirectTo: '/handy',
  },
} as const;

export function EmployeeLoginForm({ variant }: Props) {
  const cfg = VARIANT_CONFIG[variant];
  const router = useRouter();
  const [empCode, setEmpCode] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/auth/employee-signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emp_code: empCode, device_code: deviceCode }),
      });
      const json = await res.json();

      if (!res.ok) {
        setErrorMsg(json.message ?? `ログイン失敗 (${res.status})`);
        return;
      }
      router.replace(cfg.redirectTo);
      router.refresh();
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <form
        onSubmit={onSubmit}
        className="max-w-md w-full bg-white rounded-xl shadow-md p-8 space-y-4"
      >
        <h1 className="text-xl font-bold text-gray-800">{cfg.title}</h1>
        <p className="text-xs text-gray-500">{cfg.description}</p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">社員番号</label>
          <input
            type="text"
            inputMode="numeric"
            required
            autoFocus
            value={empCode}
            onChange={(e) => setEmpCode(e.target.value)}
            className="w-full border rounded px-3 py-3 text-lg"
            placeholder="0001"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">端末コード</label>
          <input
            type="text"
            required
            value={deviceCode}
            onChange={(e) => setDeviceCode(e.target.value.toUpperCase())}
            className="w-full border rounded px-3 py-3 text-lg uppercase"
            placeholder={cfg.deviceCodePlaceholder}
          />
        </div>

        {errorMsg && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !empCode || !deviceCode}
          className="w-full bg-blue-600 text-white rounded py-3 text-lg font-medium hover:bg-blue-700 disabled:bg-gray-300"
        >
          {busy ? 'ログイン中…' : 'ログイン'}
        </button>

        <p className="text-xs text-gray-400 pt-2">
          初期: 社員番号 0001 / 端末 {cfg.deviceCodePlaceholder}
        </p>
      </form>
    </main>
  );
}
