'use client';

/**
 * タブレット / ハンディ ログインフォーム（Sprint Y-8）
 *
 * - ダークブルー背景・LogiSmile ロゴを大きく配置
 * - 端末コードは GET /api/auth/devices?type=tablet|handy から取得し、
 *   登録済み端末のみセレクトで選択可能（重複登録防止）
 * - 前回ログインの端末コードは localStorage に保存し、初回起動でプリセット
 * - 占有中の端末は「使用中」表示でグレーアウト（強制ログイン可の場合のみ警告ダイアログ）
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';

interface Props {
  variant: 'tablet' | 'handy';
}

const VARIANT_CONFIG = {
  tablet: {
    title: 'タブレット検品',
    sub: 'HP14 タブレット',
    redirectTo: '/tablet',
    placeholder: 'TBL-01',
  },
  handy: {
    title: 'ハンディ検品',
    sub: 'KEYENCE BT-A500',
    redirectTo: '/handy',
    placeholder: 'HDY-01',
  },
} as const;

interface DeviceOption {
  code: string;
  name: string;
  type: string;
  location: string | null;
  inUseBy: string | null;
  activeSince: string | null;
  idleMin: number | null;
  stale: boolean;
}

const REMEMBER_DEVICE_KEY = (variant: 'tablet' | 'handy') =>
  `wms.${variant}.lastDeviceCode`;

export function EmployeeLoginForm({ variant }: Props) {
  const cfg = VARIANT_CONFIG[variant];
  const router = useRouter();
  const [empCode, setEmpCode] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [devices, setDevices] = useState<DeviceOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [forcePrompt, setForcePrompt] = useState<{
    msg: string;
    inUseBy: string | null;
    activeSince: string | null;
  } | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      const r = await fetch(`/api/auth/devices?type=${variant}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const items: DeviceOption[] = j.data?.items ?? [];
      setDevices(items);

      // 前回端末を復元（存在しないコードは無視）
      const last =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(REMEMBER_DEVICE_KEY(variant))
          : null;
      if (last && items.some((d) => d.code === last)) {
        setDeviceCode(last);
      } else if (items.length > 0) {
        // 空きの最初の端末を初期選択
        const firstFree = items.find((d) => !d.inUseBy) ?? items[0];
        setDeviceCode(firstFree.code);
      }
    } catch (e) {
      setErrorMsg(`端末一覧の取得に失敗: ${(e as Error).message}`);
      setDevices([]);
    }
  }, [variant]);

  useEffect(() => {
    void loadDevices();
    // 占有状況は他端末でログアウトされたら更新したいので 30 秒ごと再取得
    const id = setInterval(loadDevices, 30000);
    return () => clearInterval(id);
  }, [loadDevices]);

  const selectedDevice = useMemo(
    () => devices?.find((d) => d.code === deviceCode) ?? null,
    [devices, deviceCode],
  );

  async function performSignIn(force: boolean) {
    setBusy(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/auth/employee-signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emp_code: empCode,
          device_code: deviceCode,
          force,
        }),
      });
      const json = await res.json();

      if (res.status === 409 && json.error === 'DEVICE_STALE' && !force) {
        setForcePrompt({
          msg: json.message,
          inUseBy: json.inUseBy ?? null,
          activeSince: json.activeSince ?? null,
        });
        return;
      }
      if (res.status === 409 && json.error === 'DEVICE_IN_USE') {
        setErrorMsg(
          `${json.message}（占有: ${json.inUseBy ?? '不明'}）`,
        );
        // 端末一覧を再取得して最新の占有状況に更新
        void loadDevices();
        return;
      }
      if (!res.ok) {
        setErrorMsg(json.message ?? `ログイン失敗 (${res.status})`);
        return;
      }

      // 成功 → 前回端末を保存して遷移
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(REMEMBER_DEVICE_KEY(variant), deviceCode);
      }
      router.replace(cfg.redirectTo);
      router.refresh();
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!deviceCode || !empCode) return;
    void performSignIn(false);
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse at top, #1e3a8a 0%, #0f172a 55%, #020617 100%)',
        color: '#f1f5f9',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-160px',
          right: '-160px',
          width: 480,
          height: 480,
          background:
            'radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)',
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />

      <div className="relative w-full max-w-md">
        {/* ロゴ */}
        <div className="text-center mb-6">
          <LogiSmileLogo height={56} className="inline-block" />
          <p
            className="text-2xs uppercase tracking-[0.3em] mt-2"
            style={{ color: '#93c5fd' }}
          >
            {cfg.title} / {cfg.sub}
          </p>
        </div>

        {/* カード */}
        <form
          onSubmit={onSubmit}
          className="rounded-2xl p-6 space-y-4"
          style={{
            background: 'rgba(15, 23, 42, 0.78)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(148, 163, 184, 0.18)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
          }}
        >
          {/* 端末コード（プルダウン） */}
          <div>
            <label
              className="block text-xs font-bold mb-1.5 tracking-wider"
              style={{ color: '#cbd5e1' }}
            >
              端末コード
            </label>
            {!devices ? (
              <div className="text-xs" style={{ color: '#94a3b8' }}>
                端末一覧を読み込み中…
              </div>
            ) : devices.length === 0 ? (
              <div
                className="text-xs rounded p-2"
                style={{
                  background: 'rgba(127, 29, 29, 0.4)',
                  color: '#fecaca',
                  border: '1px solid rgba(220, 38, 38, 0.5)',
                }}
              >
                ⚠ 登録済みの端末がありません。管理 PC で「端末マスタ」に登録してください。
              </div>
            ) : (
              <select
                value={deviceCode}
                onChange={(e) => setDeviceCode(e.target.value)}
                required
                className="w-full rounded-lg px-3 text-base"
                style={{
                  background: 'rgba(2, 6, 23, 0.8)',
                  color: '#f1f5f9',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  height: 48,
                  outline: 'none',
                }}
              >
                <option value="">— 端末を選択 —</option>
                {devices.map((d) => {
                  const inUse = !!d.inUseBy;
                  const stale = d.stale;
                  const label = `${d.code} ${d.name}${
                    d.location ? ` (${d.location})` : ''
                  }${
                    inUse
                      ? stale
                        ? ` ⚠ 占有 ${d.inUseBy} ${d.idleMin}分未操作`
                        : ` 🔒 使用中 ${d.inUseBy}`
                      : ''
                  }`;
                  return (
                    <option
                      key={d.code}
                      value={d.code}
                      disabled={inUse && !stale}
                    >
                      {label}
                    </option>
                  );
                })}
              </select>
            )}
            {selectedDevice && selectedDevice.inUseBy && (
              <p
                className="text-2xs mt-1.5"
                style={{
                  color: selectedDevice.stale ? '#fbbf24' : '#fecaca',
                }}
              >
                {selectedDevice.stale
                  ? `⚠ 占有中ですが ${selectedDevice.idleMin} 分未操作です。続行で強制ログインに切替えます。`
                  : `🔒 占有中: ${selectedDevice.inUseBy}（解除されるまでログインできません）`}
              </p>
            )}
          </div>

          {/* 社員番号 */}
          <div>
            <label
              className="block text-xs font-bold mb-1.5 tracking-wider"
              style={{ color: '#cbd5e1' }}
            >
              社員番号
            </label>
            <input
              type="text"
              inputMode="numeric"
              required
              autoFocus
              value={empCode}
              onChange={(e) => setEmpCode(e.target.value)}
              autoComplete="off"
              className="w-full rounded-lg px-4 text-2xl font-mono tabular-nums text-center"
              style={{
                background: 'rgba(2, 6, 23, 0.8)',
                color: '#fbbf24',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                height: 56,
                letterSpacing: 4,
                outline: 'none',
              }}
              placeholder="0001"
            />
          </div>

          {errorMsg && (
            <div
              className="text-sm rounded-lg p-3"
              style={{
                background: 'rgba(127, 29, 29, 0.4)',
                color: '#fecaca',
                border: '1px solid rgba(220, 38, 38, 0.5)',
              }}
            >
              ⚠ {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !empCode || !deviceCode}
            className="w-full font-bold text-base rounded-lg transition-all"
            style={{
              height: 52,
              background:
                busy || !empCode || !deviceCode
                  ? 'rgba(217, 119, 6, 0.3)'
                  : 'linear-gradient(180deg, #fbbf24 0%, #d97706 100%)',
              color:
                busy || !empCode || !deviceCode ? '#fde68a' : '#422006',
              boxShadow:
                busy || !empCode || !deviceCode
                  ? 'none'
                  : '0 4px 14px rgba(251, 191, 36, 0.35), inset 0 1px 0 rgba(255,255,255,0.4)',
              cursor:
                busy || !empCode || !deviceCode ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'ログイン中…' : '🔐 ログイン (Enter)'}
          </button>
        </form>

        <p
          className="text-3xs mt-4 text-center"
          style={{ color: '#64748b' }}
        >
          © LogiSmile / 大江ノ郷自然牧場 — 社内ネットワーク限定
        </p>
      </div>

      {/* 強制ログイン確認ダイアログ */}
      {forcePrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setForcePrompt(null)}
        >
          <div
            className="rounded-2xl p-5 max-w-sm w-full"
            style={{
              background: '#1e293b',
              border: '1px solid rgba(251, 191, 36, 0.5)',
              color: '#f1f5f9',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold mb-2" style={{ color: '#fbbf24' }}>
              ⚠ 強制ログインの確認
            </h3>
            <p className="text-sm leading-relaxed mb-4">
              {forcePrompt.msg}
              <br />
              <span className="text-2xs" style={{ color: '#94a3b8' }}>
                占有中: {forcePrompt.inUseBy ?? '不明'}
                {forcePrompt.activeSince &&
                  ` / 開始: ${formatDateJp(forcePrompt.activeSince)}`}
              </span>
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setForcePrompt(null)}
                className="px-4 py-2 rounded-lg text-sm"
                style={{
                  background: 'rgba(51, 65, 85, 0.6)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  setForcePrompt(null);
                  void performSignIn(true);
                }}
                className="px-4 py-2 rounded-lg text-sm font-bold"
                style={{
                  background:
                    'linear-gradient(180deg, #fbbf24 0%, #d97706 100%)',
                  color: '#422006',
                }}
              >
                強制ログイン
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function formatDateJp(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
