'use client';

/**
 * 基幹連携ステータス バナー（A-11）
 *
 * モック準拠（管理用PCモック_v0.22.html L3048-3075）の 5 カード。
 *
 * GET /api/link/status を 30 秒ポーリング。
 */

import { useEffect, useState } from 'react';

interface Status {
  connection: { status: 'ok' | 'warn' | 'err'; label: string; detail: string };
  lastImport: {
    importedAt: string;
    filename: string;
    fileType: string;
    successCount: number;
    errorCount: number;
  } | null;
  todayImports: { total: number; success: number; warn: number; failed: number };
  unmap: { product: number; customer: number };
  nextImport: string | null;
}

export function LinkStatusBanner() {
  const [data, setData] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/link/status');
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setData(j.data);
      } catch {
        /* ignore */
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data) {
    return (
      <div className="text-2xs text-ink-muted py-1.5">読み込み中…</div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-1.5">
      <Card label="基幹接続">
        <div className="text-base font-bold text-status-ok">● {data.connection.label}</div>
        <div className="text-3xs text-ink-muted truncate">{data.connection.detail}</div>
      </Card>
      <Card label="最終取込">
        <div className="text-base font-bold text-ink-strong tabular-nums font-mono">
          {data.lastImport ? formatTime(data.lastImport.importedAt) : '—'}
        </div>
        <div className="text-3xs text-ink-muted truncate">
          {data.lastImport
            ? `${data.lastImport.fileType} ／ ${data.lastImport.successCount} 件`
            : 'なし'}
        </div>
      </Card>
      <Card label="本日の取込回数">
        <div className="text-base font-bold text-ink-strong tabular-nums">
          {data.todayImports.total}
          <span className="text-2xs text-ink-muted ml-0.5 font-normal">回</span>
        </div>
        <div className="text-3xs text-ink-muted">
          成功 {data.todayImports.success} ／ 警告{' '}
          <span className={data.todayImports.warn > 0 ? 'text-status-warn' : ''}>
            {data.todayImports.warn}
          </span>{' '}
          ／ 失敗{' '}
          <span className={data.todayImports.failed > 0 ? 'text-status-error' : ''}>
            {data.todayImports.failed}
          </span>
        </div>
      </Card>
      <Card label="未マップ件数">
        <div
          className={`text-base font-bold tabular-nums ${
            data.unmap.product + data.unmap.customer > 0
              ? 'text-status-warn'
              : 'text-status-ok'
          }`}
        >
          商品 {data.unmap.product} / 顧客 {data.unmap.customer}
        </div>
        <div className="text-3xs text-ink-muted">補助マスタ追加が必要</div>
      </Card>
      <Card label="次回自動取込">
        <div className="text-base font-bold text-ink-muted tabular-nums">
          {data.nextImport ? formatTime(data.nextImport) : '—'}
        </div>
        <div className="text-3xs text-ink-muted">
          {data.nextImport ? '自動スケジュール' : '手動取込のみ'}
        </div>
      </Card>
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-base border border-surface-border rounded px-2 py-1.5">
      <div className="text-3xs text-ink-muted mb-0.5">{label}</div>
      {children}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
