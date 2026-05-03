'use client';

/**
 * 管理PC ヘッダの KPI チップ群
 *
 * モック準拠（管理用PCモック_v0.22.html L2290〜2294）：
 *   - ● 接続中
 *   - 📅 日付
 *   - 📦 本日出荷 N 件
 *   - ✅ 完了 N 件
 *   - ⏰ 18:00 まで HH:MM:SS（締切カウントダウン）
 *
 * 出荷件数は /api/dashboard/progress から 30秒ポーリングで取得。
 * カウントダウンは 1秒間隔のローカル時計で計算。
 */

import { useEffect, useState } from 'react';

const DEADLINE_HOUR = 18; // 18:00 締切

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${y}/${m}/${day}（${dow}）`;
}

function formatCountdown(now: Date): string {
  const target = new Date(now);
  target.setHours(DEADLINE_HOUR, 0, 0, 0);
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return '00:00:00';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function AdminTopChips() {
  const [now, setNow] = useState<Date | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [connected, setConnected] = useState(true);

  // 1秒時計
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // 30秒ポーリングで進捗
  useEffect(() => {
    let aborted = false;
    async function load() {
      try {
        const r = await fetch('/api/dashboard/progress');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (aborted) return;
        if (j?.data?.overall) {
          setTotal(j.data.overall.total ?? 0);
          setDone(j.data.overall.packed ?? 0);
        }
        setConnected(true);
      } catch {
        if (!aborted) setConnected(false);
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      aborted = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex items-center gap-1.5 flex-1 overflow-x-auto">
      <Chip>
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            connected ? 'bg-status-ok' : 'bg-status-error animate-pulse'
          }`}
        />
        {connected ? '接続中' : '切断'}
      </Chip>
      <Chip>📅 {now ? formatDate(now) : '—'}</Chip>
      <Chip>
        📦 本日出荷 <Strong>{total !== null ? total.toLocaleString() : '—'}</Strong> 件
      </Chip>
      <Chip>
        ✅ 完了 <Strong>{done !== null ? done.toLocaleString() : '—'}</Strong> 件
      </Chip>
      <Chip variant="deadline">
        ⏰ {DEADLINE_HOUR}:00まで{' '}
        <Strong className="text-status-error">
          {now ? formatCountdown(now) : '—'}
        </Strong>
      </Chip>
    </div>
  );
}

function Chip({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant?: 'deadline';
}) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs whitespace-nowrap ${
        variant === 'deadline'
          ? 'bg-surface-base border-status-error/40 text-ink'
          : 'bg-surface-base border-surface-border text-ink'
      }`}
    >
      {children}
    </div>
  );
}

function Strong({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <b className={`text-accent-amber tabular-nums font-bold ${className}`}>{children}</b>
  );
}
