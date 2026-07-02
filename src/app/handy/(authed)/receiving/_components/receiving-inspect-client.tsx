'use client';

/**
 * ハンディ 発送日別 受入検品クライアント（Phase 5）。
 *  発送日を選び、その日の入庫予定商品（クラフトスマイル発送予定）ごとに検品実数を記録する。
 *  記録は POST /api/handy/receiving-inspect → inspection_count(ship_date+inspectedQty)。
 *  検品照合グリッド④⑧の集計元。
 */

import { useCallback, useEffect, useState } from 'react';

type PickItem = {
  productCode: string;
  productName: string | null;
  productionDeptName: string | null;
  plannedQty: number;
  confirmedQty: number | null;
  deliveredQty: number;
  inspectedQty: number;
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function ReceivingInspectClient() {
  const [date, setDate] = useState(todayYmd());
  const [items, setItems] = useState<PickItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/handy/pick-list?shipDate=${date}`);
      const j = await r.json();
      if (!r.ok) {
        setError(j?.message ?? `HTTP ${r.status}`);
        setItems([]);
        return;
      }
      setItems((j.data?.items ?? []) as PickItem[]);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [date]);

  useEffect(() => {
    void reload();
    setInputs({});
  }, [reload]);

  const record = async (it: PickItem) => {
    const raw = inputs[it.productCode];
    const qty = Number(raw);
    if (raw == null || raw === '' || !Number.isInteger(qty) || qty < 0) {
      setFlash(`⚠ ${it.productName ?? it.productCode}: 数量を入力してください`);
      return;
    }
    setSavingCode(it.productCode);
    try {
      const r = await fetch('/api/handy/receiving-inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipDate: date, productCode: it.productCode, inspectedQty: qty }),
      });
      const j = await r.json();
      if (!r.ok) {
        setFlash(`⚠ ${j?.message ?? `HTTP ${r.status}`}`);
        return;
      }
      // ローカル反映
      setItems((prev) =>
        prev.map((p) => (p.productCode === it.productCode ? { ...p, inspectedQty: qty } : p)),
      );
      setInputs((prev) => ({ ...prev, [it.productCode]: '' }));
      setFlash(`✓ ${it.productName ?? it.productCode}: 検品 ${qty} を記録`);
    } catch (e) {
      setFlash(`⚠ ${String(e)}`);
    } finally {
      setSavingCode(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-2 gap-2 overflow-y-auto">
      {/* 発送日セレクタ */}
      <div className="flex items-center gap-1.5 text-2xs">
        <button
          type="button"
          onClick={() => setDate((d) => shiftYmd(d, -1))}
          className="px-2 py-1.5 rounded border border-surface-border bg-surface-panel"
        >
          ◀ 前日
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 bg-surface-panel border border-surface-border rounded px-2 py-1.5 text-2xs text-ink"
        />
        <button
          type="button"
          onClick={() => setDate((d) => shiftYmd(d, 1))}
          className="px-2 py-1.5 rounded border border-surface-border bg-surface-panel"
        >
          翌日 ▶
        </button>
        <button
          type="button"
          onClick={() => setDate(todayYmd())}
          className="px-2 py-1.5 rounded border border-surface-border bg-surface-panel"
        >
          今日
        </button>
      </div>

      <div className="text-3xs text-ink-subtle">
        発送日 <b className="text-ink-strong">{date}</b> の入庫予定：{items.length} 品目
        {busy && <span className="ml-2 text-accent-amber">読込中…</span>}
      </div>

      {flash && (
        <div className="text-2xs px-2 py-1 rounded bg-surface-panel border border-surface-border text-ink-strong">
          {flash}
        </div>
      )}
      {error && (
        <div className="text-2xs px-2 py-1 rounded bg-status-error-bg text-status-error border border-status-error">
          {error}
        </div>
      )}

      {!busy && items.length === 0 && (
        <div className="text-center text-3xs text-ink-muted py-8">
          この発送日の入庫予定（クラフトスマイル連携）がありません。
        </div>
      )}

      {/* 商品カード */}
      <div className="flex flex-col gap-1.5">
        {items.map((it) => {
          const done = it.inspectedQty > 0;
          return (
            <div
              key={it.productCode}
              className={`rounded border p-2 ${
                done ? 'border-emerald-600/50 bg-emerald-950/20' : 'border-surface-border bg-surface-panel'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-ink-strong truncate">{it.productName ?? '—'}</div>
                  <div className="text-3xs text-ink-muted tabular-nums">
                    {it.productCode}
                    {it.productionDeptName ? `／${it.productionDeptName}` : ''}
                  </div>
                </div>
                {done && <span className="text-3xs text-emerald-300 font-bold shrink-0">検品済 {it.inspectedQty}</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-3xs text-ink-subtle tabular-nums">
                <span>予定 <b className="text-ink-strong">{it.plannedQty}</b></span>
                <span>確定 <b className="text-ink-strong">{it.confirmedQty ?? '—'}</b></span>
                <span>納品 <b className="text-ink-strong">{it.deliveredQty}</b></span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="検品数"
                  value={inputs[it.productCode] ?? ''}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [it.productCode]: e.target.value }))}
                  className="flex-1 bg-surface-base border border-surface-border rounded px-2 py-1.5 text-sm text-ink tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => record(it)}
                  disabled={savingCode === it.productCode}
                  className="px-3 py-1.5 rounded bg-accent-amber text-surface-base text-xs font-bold disabled:opacity-50"
                >
                  記録
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
