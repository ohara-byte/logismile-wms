'use client';

/**
 * 親商品マスタ 構成品（子）編集モーダル（2026-06-23）。
 * 親商品（SetComp）の構成品を一覧表示し、追加・削除・数量変更して一括保存する。
 * 保存は PUT /api/master/set-comps/[id]/children（全置換）。
 */

import { useState } from 'react';

interface ChildRow {
  childCode: string;
  childName: string;
  qty: number;
}

interface Props {
  setCompId: string;
  parentCode: string;
  parentName: string;
  initialChildren: { childCode: string; childName: string | null; qty: number }[];
  onClose: () => void;
  onSaved: () => void;
}

export function SetChildrenModal({
  setCompId,
  parentCode,
  parentName,
  initialChildren,
  onClose,
  onSaved,
}: Props) {
  const [rows, setRows] = useState<ChildRow[]>(
    initialChildren.map((c) => ({ childCode: c.childCode, childName: c.childName ?? '', qty: c.qty })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(i: number, patch: Partial<ChildRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }
  function add() {
    setRows((prev) => [...prev, { childCode: '', childName: '', qty: 1 }]);
  }

  async function save() {
    const cleaned = rows
      .map((r) => ({ childCode: r.childCode.trim(), childName: r.childName.trim() || null, qty: r.qty }))
      .filter((r) => r.childCode !== '');
    const codes = cleaned.map((r) => r.childCode);
    if (new Set(codes).size !== codes.length) {
      setError('構成品コードが重複しています');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/master/set-comps/${encodeURIComponent(setCompId)}/children`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ children: cleaned }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-surface-panel border border-surface-border rounded-2xl shadow-modal max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="px-4 py-3 border-b border-surface-border">
          <h2 className="text-base font-bold text-ink-strong">🎁 構成品の編集</h2>
          <p className="text-2xs text-ink-subtle mt-0.5">
            親：<b className="text-ink">{parentName}</b>（{parentCode}）／ 全置換で保存します
          </p>
        </div>

        <div className="p-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-2xs text-ink-subtle border-b border-surface-border">
                <th className="text-left px-1 py-1 w-40">構成品コード</th>
                <th className="text-left px-1 py-1">商品名（任意・空欄はマスタ補完）</th>
                <th className="text-right px-1 py-1 w-20">数量</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-surface-border/50">
                  <td className="px-1 py-1">
                    <input
                      value={r.childCode}
                      onChange={(e) => update(i, { childCode: e.target.value })}
                      placeholder="例: 7902"
                      className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs text-ink font-mono"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      value={r.childName}
                      onChange={(e) => update(i, { childName: e.target.value })}
                      className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs text-ink"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      min={1}
                      value={r.qty}
                      onChange={(e) => update(i, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs text-ink text-right tabular-nums"
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <button
                      onClick={() => remove(i)}
                      className="text-status-error hover:text-red-400 text-sm"
                      title="この構成品を削除"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-2xs text-ink-muted py-4">
                    構成品がありません。「＋ 構成品を追加」で追加してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <button
            onClick={add}
            className="mt-2 text-xs px-2.5 py-1 rounded border border-surface-border bg-surface-base text-ink-subtle hover:text-ink hover:border-accent-amber"
          >
            ＋ 構成品を追加
          </button>

          {error && (
            <div className="mt-3 text-2xs bg-status-error-bg text-status-error border border-status-error rounded p-2">
              ⚠ {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-surface-border flex justify-end gap-2 sticky bottom-0 bg-surface-panel">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded border border-surface-border bg-surface-base text-ink text-sm disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="px-4 py-2 rounded bg-brand-primary text-white text-sm font-bold hover:bg-blue-600 disabled:opacity-50"
          >
            {busy ? '保存中…' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  );
}
