'use client';

/**
 * マスタ汎用テーブル + ツールバー
 *
 * モック準拠（管理用PCモック_v0.22.html L3019-3039）。
 *
 * 機能:
 *   - 検索ボックス + フィルタ select + CSV取込/出力 + ＋新規追加
 *   - クリックで MasterEditModal を起動して編集
 *   - フッタ: 表示N/全N + 最終更新
 *
 * 子コンポーネント MasterEditModal の管理は親ペインで行う想定だが、
 * ここでは内蔵してシンプルに使えるようにする（renderless にしない）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MasterEditModal } from './master-edit-modal';
import type { MasterConfig } from './master-types';
import { useHasPermission } from '@/components/admin/role-context';

interface Props<T extends Record<string, unknown>> {
  config: MasterConfig<T>;
}

export function MasterTable<T extends Record<string, unknown>>({ config }: Props<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');

  const [editTarget, setEditTarget] = useState<T | null>(null);
  const [adding, setAdding] = useState(false);

  // Sprint Y-11: 権限ガード
  const canEdit = useHasPermission('master_edit');
  const canImport = useHasPermission('csv_import');
  const canExport = useHasPermission('csv_export');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(config.endpoint);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows(j.data?.items ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [config.endpoint]);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(() => {
    let result = rows;
    if (q.trim()) {
      const kw = q.trim().toLowerCase();
      result = result.filter((r) =>
        config.columns.some((c) => {
          const v = r[c.key as keyof T];
          return v !== null && v !== undefined && String(v).toLowerCase().includes(kw);
        }),
      );
    }
    if (filter && config.filterField) {
      result = result.filter(
        (r) => String(r[config.filterField as keyof T] ?? '') === filter,
      );
    }
    return result;
  }, [rows, q, filter, config]);

  async function handleSave(values: Record<string, unknown>) {
    if (editTarget) {
      const id = String(editTarget[config.primaryKey]);
      const r = await fetch(
        `${config.endpoint}/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${r.status}`);
      }
      setEditTarget(null);
    } else {
      const r = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${r.status}`);
      }
      setAdding(false);
    }
    reload();
  }

  async function handleDelete() {
    if (!editTarget) return;
    const id = String(editTarget[config.primaryKey]);
    const r = await fetch(`${config.endpoint}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      // Sprint Y-9: 参照中で 409 が返ったとき、ユーザーに force 削除を確認
      const msg = j?.message ?? `HTTP ${r.status}`;
      if (
        r.status === 409 &&
        typeof msg === 'string' &&
        msg.includes('force=true')
      ) {
        const ok = confirm(
          `${msg}\n\n参照を解除して強制削除しますか？\n（参照中のレコードのリンクは外され、元に戻せません）`,
        );
        if (!ok) throw new Error('削除をキャンセルしました');
        const r2 = await fetch(
          `${config.endpoint}/${encodeURIComponent(id)}?force=true`,
          { method: 'DELETE' },
        );
        if (!r2.ok) {
          const j2 = await r2.json().catch(() => ({}));
          throw new Error(j2?.message ?? `HTTP ${r2.status}`);
        }
        const j2 = await r2.json();
        if (j2?.message) alert(j2.message);
      } else {
        throw new Error(msg);
      }
    }
    setEditTarget(null);
    reload();
  }

  const visibleColumns = config.columns.filter((c) => !c.hidden);

  // Sprint Y-1 UI: マスタ全体のフォントとボタンサイズを 1〜2 段階拡大
  return (
    <div className="flex flex-col h-full">
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={config.searchPlaceholder ?? '🔍 キーワード検索（名前・コード・備考）'}
          className="flex-1 min-w-[220px] bg-surface-base border border-surface-border rounded px-3 py-2 text-sm text-ink"
        />
        {config.filterField && config.filterOptions && (
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-surface-base border border-surface-border rounded px-2 py-2 text-sm text-ink"
          >
            <option value="">{config.filterPlaceholder ?? '─ フィルタ ─'}</option>
            {config.filterOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {canImport && (
          <button
            onClick={() => alert('CSV 取込は将来ブロックで実装予定です')}
            className="text-sm px-3 py-2 rounded border border-surface-border bg-blue-950/30 text-blue-200 hover:bg-blue-900 font-bold"
          >
            📁 CSV取込
          </button>
        )}
        {canExport && (
          <button
            onClick={() => exportCsv(filtered, visibleColumns, config.title)}
            className="text-sm px-3 py-2 rounded border border-surface-border bg-amber-950/30 text-amber-200 hover:bg-amber-900 font-bold"
          >
            ⬇ CSV出力
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => setAdding(true)}
            className="text-sm px-3 py-2 rounded bg-brand-primary text-white font-bold hover:bg-blue-600"
          >
            ＋ 新規追加
          </button>
        )}
      </div>

      {error && (
        <div className="mb-2 p-2 text-xs bg-status-error-bg text-status-error border border-status-error rounded">
          {error}
        </div>
      )}

      {/* テーブル */}
      <div className="flex-1 overflow-auto border border-surface-border rounded">
        {loading ? (
          <div className="p-4 text-sm text-ink-muted">読み込み中…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-muted">
            {rows.length === 0 ? '登録がありません' : '検索条件に該当するデータがありません'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-surface-base sticky top-0 border-b border-surface-border">
              <tr>
                {visibleColumns.map((c) => (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={`px-2 py-2 text-${c.align ?? 'left'} text-2xs uppercase text-ink-subtle font-bold`}
                  >
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr
                  key={`${row[config.primaryKey]}-${idx}`}
                  className="border-t border-surface-border hover:bg-surface-base"
                >
                  {visibleColumns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-2 py-1.5 text-${c.align ?? 'left'} ${c.mono ? 'font-mono tabular-nums' : ''} ${c.truncate ? 'truncate max-w-[260px]' : ''}`}
                    >
                      {c.render ? c.render(row) : renderCell(row[c.key as keyof T])}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right">
                    {canEdit ? (
                      <button
                        onClick={() => setEditTarget(row)}
                        className="text-xs text-status-info hover:underline font-bold"
                      >
                        ✏ 編集
                      </button>
                    ) : (
                      <span className="text-2xs text-ink-muted">閲覧のみ</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* フッタ */}
      <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
        <span>
          表示 <b className="text-ink">{filtered.length}</b> / 全{' '}
          <b className="text-ink">{rows.length}</b> 件
        </span>
        <span className="text-ink-subtle">{config.hint ?? ''}</span>
      </div>

      {/* 編集モーダル */}
      <MasterEditModal<T>
        open={editTarget !== null}
        mode="edit"
        title={`${config.title} 編集`}
        hint={`主キー: ${config.primaryKey}`}
        fields={config.formFields}
        initialValues={editTarget ?? undefined}
        onSave={handleSave}
        onDelete={handleDelete}
        onCancel={() => setEditTarget(null)}
      />
      <MasterEditModal<T>
        open={adding}
        mode="add"
        title={`${config.title} 新規追加`}
        hint={config.hint}
        fields={config.formFields}
        initialValues={config.initialValues}
        onSave={handleSave}
        onCancel={() => setAdding(false)}
      />
    </div>
  );
}

function renderCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return <span className="text-ink-muted">—</span>;
  if (typeof v === 'boolean') return v ? '✓' : '○';
  if (v instanceof Date) return v.toLocaleString('ja-JP');
  return String(v);
}

function exportCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: string; label: string }[],
  title: string,
) {
  const head = columns.map((c) => `"${c.label}"`).join(',');
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        const v = r[c.key as keyof T];
        if (v === null || v === undefined) return '';
        const s = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      })
      .join(','),
  );
  const csv = '﻿' + [head, ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
