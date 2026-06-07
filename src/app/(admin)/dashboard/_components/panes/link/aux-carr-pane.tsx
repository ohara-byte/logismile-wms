'use client';

/**
 * 🚚 配送便マッピング pane（Sprint S-3）
 *
 * 基幹側の便文字列（例: 'ヤマト'）→ WMS の便種コード（YAMATO_NORMAL）への変換テーブル。
 *
 * 設計:
 *  - 現状 /api/orders/import の CSV 取込時に carrier_code が直接入る前提（マッピング済前提）
 *  - 本 pane は運送会社マスタの全件 + 当月の伝票件数（実利用状況）を一覧表示
 *  - 将来「便文字列パターン → carrier_code」のマッピングテーブルを追加するときの土台
 */

import { useEffect, useState } from 'react';

interface Carrier {
  code: string;
  name: string;
  short: string | null;
  priority: number;
  cool: boolean;
  cutoff: string | null;
  pickup: string | null;
  active: boolean;
}

interface CarrierUsage {
  code: string;
  monthlyCount: number;
  todayCount: number;
}

export function AuxCarrPane() {
  const [carriers, setCarriers] = useState<Carrier[] | null>(null);
  const [usage, setUsage] = useState<Map<string, CarrierUsage> | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [cRes, uRes] = await Promise.all([
          fetch('/api/master/carriers').then((r) => r.json()),
          fetch('/api/link/aux-carr-usage').then((r) => r.json()),
        ]);
        if (cancelled) return;
        setCarriers(cRes.data?.items ?? []);
        const map = new Map<string, CarrierUsage>();
        for (const u of (uRes.data?.items ?? []) as CarrierUsage[]) {
          map.set(u.code, u);
        }
        setUsage(map);
      } catch (e) {
        if (!cancelled) setErrorMsg(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="p-3 text-2xs text-ink-muted">読み込み中…</div>;
  }
  if (errorMsg) {
    return (
      <div className="p-3 text-2xs text-status-error bg-red-950/30 border border-status-error/40 rounded">
        ⚠ {errorMsg}
      </div>
    );
  }

  const items = carriers ?? [];
  const totalMonth = items.reduce(
    (s, c) => s + (usage?.get(c.code)?.monthlyCount ?? 0),
    0,
  );
  const totalToday = items.reduce(
    (s, c) => s + (usage?.get(c.code)?.todayCount ?? 0),
    0,
  );

  return (
    <div className="p-1 space-y-2">
      <div className="bg-blue-950/40 border border-blue-700/40 rounded p-2 text-2xs text-blue-100 leading-snug">
        💡 基幹からの出荷指示 CSV の運送会社コードは、ここに登録された <b>運送会社マスタ</b> と
        <b>code 一致</b>でマッピングされます。コード違いがあると取込時にエラーになるため、
        基幹側の便種コードと一致するよう運送会社マスタを保守してください。
        <br />
        編集はマスタタブの「🚚 運送会社」サブタブから行えます。
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="登録運送会社" value={items.length} unit="社" />
        <Stat label="当月利用件数" value={totalMonth} unit="件" />
        <Stat label="本日利用件数" value={totalToday} unit="件" />
      </div>

      <div>
        <h5 className="text-2xs font-bold text-accent-amber uppercase tracking-wider mb-1">
          📋 運送会社マッピング一覧
        </h5>
        <div className="border border-surface-border rounded overflow-auto max-h-[500px]">
          <table className="w-full text-2xs">
            <thead className="bg-surface-base sticky top-0 border-b border-surface-border">
              <tr>
                <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">code</th>
                <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">名称</th>
                <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">略称</th>
                <th className="px-2 py-1 text-center text-3xs uppercase text-ink-subtle">冷</th>
                <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">締切</th>
                <th className="px-2 py-1 text-right text-3xs uppercase text-ink-subtle">本日</th>
                <th className="px-2 py-1 text-right text-3xs uppercase text-ink-subtle">当月</th>
                <th className="px-2 py-1 text-center text-3xs uppercase text-ink-subtle">状態</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-3xs text-ink-muted py-4">
                    運送会社マスタが空です（マスタ → 🚚 運送会社 タブで追加してください）
                  </td>
                </tr>
              )}
              {items.map((c) => {
                const u = usage?.get(c.code);
                return (
                  <tr key={c.code} className="border-t border-surface-border">
                    <td className="px-2 py-1 font-mono text-blue-300">{c.code}</td>
                    <td className="px-2 py-1 font-bold">{c.name}</td>
                    <td className="px-2 py-1 text-ink-subtle">{c.short ?? '—'}</td>
                    <td className="px-2 py-1 text-center">
                      {c.cool ? <span className="text-cyan-300">❄</span> : ''}
                    </td>
                    <td className="px-2 py-1 font-mono text-3xs">{c.cutoff ?? '—'}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-bold">
                      {(u?.todayCount ?? 0).toLocaleString()}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {(u?.monthlyCount ?? 0).toLocaleString()}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {c.active ? (
                        <span className="text-status-ok text-3xs">✓</span>
                      ) : (
                        <span className="text-ink-muted text-3xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="bg-surface-base border border-surface-border rounded p-2">
      <div className="text-3xs text-ink-muted">{label}</div>
      <div className="text-base font-bold text-ink-strong tabular-nums leading-tight mt-0.5">
        {value.toLocaleString()}
        <span className="text-2xs text-ink-muted ml-1 font-normal">{unit}</span>
      </div>
    </div>
  );
}
