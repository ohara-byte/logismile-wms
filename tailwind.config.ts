import type { Config } from 'tailwindcss';

/**
 * LogiSmile デザインシステム
 *
 * モック準拠のダークテーマ (slate-900 ベース) と
 * セマンティックトークン (surface / accent / status) を定義。
 *
 * 配色ルール:
 *  - 「重要数字」「タイトル」 → amber-400 (#fbbf24)
 *  - 操作系（ボタン・リンク） → blue-600 (#2563eb)
 *  - 完了 → emerald-500 (#10b981)
 *  - 警告（強制OK等） → orange-500 (#f59e0b)
 *  - 危険 → red-600 (#dc2626)
 *  - 印刷系（QR） → pink-600 (#db2777)
 *  - 冷凍 → cyan-400 (#22d3ee)
 *  - のし・特殊 → pink-500 (#ec4899)
 */

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 表面色（ダークテーマ）
        surface: {
          base: '#0f172a', // slate-900: ページ背景
          panel: '#1e293b', // slate-800: 外側パネル
          // ★ モック準拠: パネル内の二次カード（grp-card / od-sec / ls-card 等）は
          //   外側パネルより 1 段暗い slate-900 を使い階層感を出す
          sunken: '#0f172a',
          subtle: '#0f172a', // 凹み箇所（input背景など）
          raised: '#334155', // slate-700: ホバー/活性化
          border: '#334155', // パネル境界
          'border-strong': '#475569', // 入力枠など強めの境界
        },
        // テキスト色
        ink: {
          DEFAULT: '#e2e8f0', // slate-200: 標準
          strong: '#f8fafc', // slate-50: 強調
          subtle: '#94a3b8', // slate-400: 補助
          muted: '#64748b', // slate-500: より弱
        },
        // ブランドアクセント（ロゴグラデ由来）
        brand: {
          primary: '#29A6F6', // ロゴ青
          secondary: '#00B6CB', // ロゴ青緑
          gradFrom: '#29A6F6',
          gradTo: '#00B6CB',
        },
        // セマンティック（モック配色準拠）
        accent: {
          amber: '#fbbf24', // 重要数字・タイトル強調
          'amber-deep': '#f59e0b',
          'amber-bg': '#422006', // active セルの背景
        },
        status: {
          ok: '#10b981',
          'ok-bg': '#064e3b',
          warn: '#f59e0b',
          'warn-bg': '#422006',
          error: '#dc2626',
          'error-bg': '#450a0a',
          info: '#3b82f6',
          'info-bg': '#1e3a8a',
        },
        print: {
          DEFAULT: '#db2777', // QR印刷フラグ ON
          light: '#f472b6',
          bg: '#2a0f1d',
        },
        frozen: {
          DEFAULT: '#22d3ee',
          light: '#67e8f9',
          bg: '#164e63',
        },
        // グループ別固定色（10色）
        group: {
          abl: '#64748b',
          sc: '#fb923c',
          de: '#facc15',
          fjk: '#22c55e',
          h: '#3b82f6',
          i: '#ef4444',
          rq: '#a78bfa',
          line: '#0e7490',
          sort: '#b45309',
          sas: '#6d28d9',
        },
      },
      fontFamily: {
        sans: ['"Yu Gothic UI"', '"Yu Gothic"', '"Hiragino Sans"', '"Meiryo"', 'sans-serif'],
        mono: ['Consolas', '"Courier New"', 'monospace'],
      },
      fontSize: {
        // モック内で頻出する小サイズ
        '2xs': ['10px', { lineHeight: '14px' }],
        '3xs': ['9px', { lineHeight: '12px' }],
      },
      boxShadow: {
        panel: '0 4px 20px rgba(0, 0, 0, 0.35)',
        modal: '0 20px 60px rgba(0, 0, 0, 0.5)',
        'glow-amber': '0 0 0 2px rgba(251, 191, 36, 0.3)',
        'glow-blue': '0 0 0 2px rgba(59, 130, 246, 0.4)',
      },
      animation: {
        'pulse-amber': 'pulse-amber 1.4s ease-in-out infinite',
        'flash-success': 'flash-success 0.5s ease-out',
        'flash-error': 'flash-error 0.5s ease-out',
        shake: 'shake 0.3s ease-in-out',
      },
      keyframes: {
        'pulse-amber': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(251, 191, 36, 0.5)' },
          '50%': { boxShadow: '0 0 0 8px rgba(251, 191, 36, 0)' },
        },
        'flash-success': {
          '0%': { backgroundColor: 'rgba(16, 185, 129, 0.25)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'flash-error': {
          '0%': { backgroundColor: 'rgba(220, 38, 38, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-4px)' },
          '75%': { transform: 'translateX(4px)' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
