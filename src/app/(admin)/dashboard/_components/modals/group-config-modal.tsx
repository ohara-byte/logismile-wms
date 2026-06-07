'use client';

/**
 * テーブルグループ設定モーダル（Sprint G-4）
 *
 * モック準拠（管理用PCモック_v0.22.html L4745-4772 / L5871-5902）。
 *
 * 機能:
 *  - 各グループのテーブル一覧（クリックで未所属プールへ移動）
 *  - 「+テーブル追加」で未所属プールから取り込み
 *  - 「+新規グループ追加」で空のグループを作成
 *  - 🗑 でグループ削除（テーブルは未所属プールへ戻る）
 *  - 「この構成で保存」で各グループに対して PUT /api/master/groups/[id]
 */

import { useEffect, useState } from 'react';

interface GroupRow {
  id: string;
  name: string;
  tables: string[];
  category: string;
  needStaff: number;
  isNew?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

// 既知のテーブル全体プール（グループに属していないテーブルがあればここで補う）
// 既存マスタに無いテーブルは末尾の補助プールから追加可能。
const KNOWN_TABLES_POOL = [
  'A', 'B', 'L', 'S', 'C', 'D', 'E', 'F', 'J', 'K', 'H', 'I', 'R', 'Q',
  'M', 'N', 'P', 'T', 'U', 'W',
];

export function GroupConfigModal({ open, onClose, onSaved }: Props) {
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [pool, setPool] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ groupId: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setStatusMsg(null);
    void loadAll();
  }, [open]);

  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  async function loadAll() {
    setBusy(true);
    try {
      const r = await fetch('/api/master/groups');
      const j = await r.json();
      const items: GroupRow[] = (j.data?.items ?? []).map((g: GroupRow) => ({
        id: g.id,
        name: g.name,
        tables: g.tables ?? [],
        category: g.category ?? 'group',
        needStaff: g.needStaff ?? 1,
      }));
      // 未所属プール = 既知テーブル ‐ 全グループに含まれるテーブル
      const used = new Set(items.flatMap((g) => g.tables));
      const remain = KNOWN_TABLES_POOL.filter((t) => !used.has(t));
      setGroups(items);
      setPool(remain);
    } finally {
      setBusy(false);
    }
  }

  function moveTableToPool(groupId: string, table: string) {
    if (!groups) return;
    setGroups(groups.map((g) => (g.id === groupId ? { ...g, tables: g.tables.filter((t) => t !== table) } : g)));
    setPool((prev) => Array.from(new Set([...prev, table])));
  }

  function addTableToGroup(groupId: string, table: string) {
    if (!groups) return;
    setGroups(groups.map((g) => (g.id === groupId ? { ...g, tables: [...g.tables, table] } : g)));
    setPool((prev) => prev.filter((t) => t !== table));
    setPicker(null);
  }

  function addNewGroup() {
    if (!groups) return;
    let n = 1;
    while (groups.some((g) => g.id === `G${n}`)) n++;
    const id = `G${n}`;
    setGroups([
      ...groups,
      { id, name: id, tables: [], category: 'group', needStaff: 1, isNew: true },
    ]);
  }

  function removeGroup(groupId: string) {
    if (!groups) return;
    if (!confirm(`グループ ${groupId} を削除します。所属テーブルは未所属プールに戻ります。よろしいですか？`)) return;
    const target = groups.find((g) => g.id === groupId);
    if (!target) return;
    setGroups(groups.filter((g) => g.id !== groupId));
    setPool((prev) => Array.from(new Set([...prev, ...target.tables])));
  }

  function renameGroup(groupId: string) {
    if (!groups) return;
    const cur = groups.find((g) => g.id === groupId);
    const name = prompt(`グループ名を編集 (${cur?.id})`, cur?.name ?? '');
    if (name === null || name.trim() === '') return;
    setGroups(groups.map((g) => (g.id === groupId ? { ...g, name: name.trim() } : g)));
  }

  async function save() {
    if (!groups) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      // 既存マスタとの同期: シンプルに全グループに対して upsert（既存=PUT / 新規=POST）
      for (const g of groups) {
        const body = {
          id: g.id,
          name: g.name,
          tables: g.tables,
          category: g.category,
          needStaff: g.needStaff,
        };
        if (g.isNew) {
          const r = await fetch('/api/master/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!r.ok) throw new Error((await r.json()).message ?? `POST ${g.id} 失敗`);
        } else {
          const r = await fetch(`/api/master/groups/${encodeURIComponent(g.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!r.ok) throw new Error((await r.json()).message ?? `PUT ${g.id} 失敗`);
        }
      }
      setStatusMsg('✓ 保存しました');
      onSaved?.();
      // モーダルは保存後そのまま開いたまま（連続編集用）
      void loadAll();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[55] flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-surface-panel border-2 border-accent-amber rounded-[10px] shadow-modal w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* ヘッダ */}
        <div className="px-4 py-2.5 border-b border-surface-border flex items-center justify-between bg-amber-950/30">
          <h2 className="text-base font-bold text-accent-amber">
            ⚙ テーブルグループ設定（当日分）
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-ink-muted hover:text-status-error text-xl leading-none px-2 disabled:opacity-50"
            title="閉じる (Esc)"
          >
            ×
          </button>
        </div>

        {/* ヒント */}
        <div className="px-4 py-1.5 bg-surface-base/60 border-b border-surface-border text-2xs text-ink-subtle leading-snug">
          💡 テーブルをクリックで外す（未所属プールへ）／「+テーブル追加」で未所属から取り込み／「+新規グループ追加」で空のグループを作成／グループ名はクリックで編集
        </div>

        {/* 本体 */}
        <div className="flex-1 overflow-auto px-4 py-3 space-y-2.5">
          {!groups && <div className="text-sm text-ink-muted">読込中…</div>}
          {groups?.map((g) => (
            <div
              key={g.id}
              className="flex items-center gap-2 bg-surface-base border border-surface-border rounded-md px-2 py-1.5"
            >
              <button
                type="button"
                onClick={() => renameGroup(g.id)}
                className="font-bold text-ink-strong text-sm w-16 text-left hover:text-accent-amber"
                title="クリックで名称編集"
              >
                {g.name}
              </button>
              <div className="flex-1 flex items-center gap-1 flex-wrap">
                {g.tables.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => moveTableToPool(g.id, t)}
                    className="px-2 py-0.5 rounded bg-blue-900/50 text-blue-100 text-xs font-mono hover:bg-red-900/60 hover:text-red-100 transition-colors"
                    title="クリックで未所属プールへ"
                  >
                    {t} <span className="opacity-70">×</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPicker({ groupId: g.id })}
                  className="px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-100 text-xs hover:bg-emerald-900/80 transition-colors"
                >
                  + テーブル追加
                </button>
              </div>
              <button
                type="button"
                onClick={() => removeGroup(g.id)}
                className="text-status-error hover:bg-red-950/40 px-2 py-1 rounded text-sm"
                title="グループ削除"
              >
                🗑
              </button>
            </div>
          ))}

          {/* 新規グループ */}
          <button
            type="button"
            onClick={addNewGroup}
            className="w-full py-1.5 rounded border border-dashed border-surface-border-strong text-2xs text-ink-subtle hover:bg-surface-base hover:text-accent-amber"
          >
            + 新規グループ追加
          </button>

          {/* 未所属プール */}
          <div className="bg-amber-950/20 border border-amber-700/40 rounded-md px-2 py-1.5">
            <div className="text-2xs text-accent-amber font-bold mb-1">
              🛒 未所属テーブル（プール）
            </div>
            <div className="flex flex-wrap gap-1">
              {pool.length === 0 && (
                <span className="text-3xs text-ink-muted">（なし）</span>
              )}
              {pool.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded bg-amber-900/50 text-amber-100 text-xs font-mono"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* テーブル選択ピッカー */}
          {picker && (
            <div className="bg-surface-panel border-2 border-accent-amber rounded-md p-2">
              <div className="text-2xs text-accent-amber font-bold mb-1">
                {picker.groupId} に追加するテーブルを選択
              </div>
              <div className="flex flex-wrap gap-1">
                {pool.length === 0 && (
                  <span className="text-3xs text-ink-muted">プールが空です</span>
                )}
                {pool.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addTableToGroup(picker.groupId, t)}
                    className="px-2 py-0.5 rounded bg-amber-900/50 hover:bg-amber-700 text-amber-100 text-xs font-mono"
                  >
                    {t}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPicker(null)}
                  className="ml-auto text-3xs text-ink-muted hover:text-status-error px-2"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}
        </div>

        {/* フッタ */}
        <div className="px-4 py-2.5 border-t border-surface-border bg-surface-panel flex items-center justify-between gap-2">
          <div className="text-2xs">
            {errorMsg && <span className="text-status-error">⚠ {errorMsg}</span>}
            {!errorMsg && statusMsg && <span className="text-status-ok">{statusMsg}</span>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-4 py-1.5 rounded border border-surface-border bg-surface-base text-sm disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              onClick={save}
              disabled={busy || !groups}
              className="px-4 py-1.5 rounded bg-accent-amber text-slate-900 font-bold text-sm disabled:opacity-50"
            >
              ✓ この構成で保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
