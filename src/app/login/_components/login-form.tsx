'use client';

/**
 * 管理 PC ログインフォーム（Sprint Y-8）
 *
 * - ダークブルー背景（ラジアル + 縦グラデーション）
 * - LogiSmile ロゴを大きく配置
 * - 前回ログイン時のメールアドレスを localStorage に保存し、初回フォーカスで再入力不要に
 *
 * 認証は NextAuth credentials provider（既存）。
 */

import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';

const REMEMBER_EMAIL_KEY = 'wms.login.lastEmail';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // callbackUrl は同一オリジン内パス（先頭 "/" + 2文字目が "/" でない）のみ許可
  const rawCallback = params.get('callbackUrl') || '/dashboard';
  const callbackUrl =
    rawCallback.startsWith('/') && !rawCallback.startsWith('//')
      ? rawCallback
      : '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // マウント時に前回のメールを復元 → パスワードへフォーカス
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const last = window.localStorage.getItem(REMEMBER_EMAIL_KEY);
    if (last) {
      setEmail(last);
      setTimeout(() => passwordRef.current?.focus(), 50);
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);

    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setBusy(false);
    if (res?.ok) {
      // 「次回も記憶」ON のときのみ保存
      if (rememberMe && typeof window !== 'undefined') {
        window.localStorage.setItem(REMEMBER_EMAIL_KEY, email);
      } else if (!rememberMe && typeof window !== 'undefined') {
        window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
      }
      router.replace(callbackUrl);
      router.refresh();
    } else {
      setErrorMsg('メールアドレスまたはパスワードが違います');
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse at top, #1e3a8a 0%, #0f172a 55%, #020617 100%)',
        color: '#f1f5f9',
      }}
    >
      {/* 背景の装飾オーブ */}
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
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-200px',
          left: '-200px',
          width: 560,
          height: 560,
          background:
            'radial-gradient(circle, rgba(251,191,36,0.10) 0%, transparent 70%)',
          filter: 'blur(60px)',
          pointerEvents: 'none',
        }}
      />

      <div className="relative max-w-md w-full">
        {/* ヒーロー：ロゴ大型表示 */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center mb-3">
            <LogiSmileLogo height={64} />
          </div>
          <p
            className="text-xs uppercase tracking-[0.3em]"
            style={{ color: '#93c5fd' }}
          >
            大江ノ郷自然牧場 / WMS 管理コンソール
          </p>
        </div>

        {/* ログインカード */}
        <form
          onSubmit={onSubmit}
          className="rounded-2xl p-7 space-y-5"
          style={{
            background: 'rgba(15, 23, 42, 0.78)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(148, 163, 184, 0.18)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
          }}
        >
          <div>
            <h1 className="text-lg font-bold" style={{ color: '#fbbf24' }}>
              ログイン
            </h1>
            <p className="text-xs" style={{ color: '#94a3b8' }}>
              メールアドレスとパスワードを入力してください
            </p>
          </div>

          <div>
            <label
              className="block text-xs font-bold mb-1.5 tracking-wider"
              style={{ color: '#cbd5e1' }}
            >
              メールアドレス
            </label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              className="w-full rounded-lg px-4 text-base"
              style={{
                background: 'rgba(2, 6, 23, 0.8)',
                color: '#f1f5f9',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                height: 48,
                outline: 'none',
              }}
              placeholder="admin@wms.local"
            />
          </div>

          <div>
            <label
              className="block text-xs font-bold mb-1.5 tracking-wider"
              style={{ color: '#cbd5e1' }}
            >
              パスワード
            </label>
            <div className="relative">
              <input
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-lg px-4 pr-20 text-base font-mono"
                style={{
                  background: 'rgba(2, 6, 23, 0.8)',
                  color: '#f1f5f9',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  height: 48,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded"
                style={{
                  color: '#cbd5e1',
                  background: 'rgba(51, 65, 85, 0.6)',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                }}
              >
                {showPassword ? '🙈 隠す' : '👁 表示'}
              </button>
            </div>
          </div>

          <label
            className="flex items-center gap-2 text-xs cursor-pointer"
            style={{ color: '#cbd5e1' }}
          >
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 cursor-pointer"
            />
            次回もこの端末でメールアドレスを記憶する
          </label>

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
            disabled={busy}
            className="w-full font-bold text-sm rounded-lg transition-all"
            style={{
              height: 48,
              background: busy
                ? 'rgba(217, 119, 6, 0.5)'
                : 'linear-gradient(180deg, #fbbf24 0%, #d97706 100%)',
              color: busy ? '#fde68a' : '#422006',
              boxShadow: busy
                ? 'none'
                : '0 4px 14px rgba(251, 191, 36, 0.35), inset 0 1px 0 rgba(255,255,255,0.4)',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'ログイン中…' : '🔐 ログイン'}
          </button>
        </form>

        {/* フッター情報 */}
        <div className="mt-6 text-center space-y-1">
          <p className="text-xs" style={{ color: '#64748b' }}>
            © LogiSmile / 大江ノ郷自然牧場
          </p>
          <p className="text-xs" style={{ color: '#475569' }}>
            社内ネットワーク限定 / 営業時間 9:00-18:00
          </p>
        </div>
      </div>
    </main>
  );
}
