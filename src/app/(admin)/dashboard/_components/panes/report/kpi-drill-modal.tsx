'use client';

/**
 * KPI ドリルダウンモーダル（共通）— Sprint A
 *
 * モック準拠（管理用PCモック_v0.22.html L1822-1873 / L9413-9447）。
 *
 * 使い方:
 *   <KpiDrillModal
 *     open={key === 'totalShip'}
 *     loading={loading}
 *     title="総出荷数 — 明細"
 *     subtitle={`${from} 〜 ${to} 期間中の出荷伝票（上位 ${rows.length} 件）`}
 *     cols={['伝票No','顧客','配送便','テーブル','明細','日付','状態']}
 *     rows={rows}
 *     onClose={() => setKey(null)}
 *     onRowClick={(row) => router.push(`/orders?pkNo=${row[0]}`)}
 *   />
 */

import { useEffect } from 'react';

export type DrillCell = string | number | null | undefined;

interface Props {
  open: boolean;
  loading?: boolean;
  errorMsg?: string | null;
  title: string;
  subtitle?: string;
  cols: string[];
  rows: DrillCell[][];
  emptyHint?: string;
  /** 0 列目を「コード列」として等幅表示する（伝票No 等） */
  codeFirstCol?: boolean;
  onClose: () => void;
  onRowClick?: (row: DrillCell[]) => void;
}

export function KpiDrillModal({
  open,
  loading,
  errorMsg,
  title,
  subtitle,
  cols,
  rows,
  emptyHint,
  codeFirstCol,
  onClose,
  onRowClick,
}: Props) {
  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // 数値判定（カンマ・%・小数点を含む）
  const isNumLike = (v: DrillCell): boolean => {
    if (typeof v === 'number') return true;
    if (typeof v !== 'string') return false;
    return /^-?[\d,.%¥]+$/.test(v.trim());
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-panel border-2 border-accent-amber rounded-[10px] shadow-modal w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* ヘッダ */}
        <div className="px-4 py-2.5 border-b border-surface-border flex items-center gap-3 bg-blue-950/30">
          <h3 className="text-base font-bold text-blue-200 flex-1 truncate">
            🔍 {title}
          </h3>
          <span className="text-3xs text-ink-muted hidden md:block">
            レポート → 明細ドリルダウン
          </span>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-status-error text-xl leading-none px-2"
            title="閉じる (Esc)"
          >
            ×
          </button>
        </div>

        {/* サマリ */}
        {subtitle && (
          <div className="px-4 py-1.5 bg-surface-base/60 border-b border-surface-border text-2xs text-ink-subtle">
            {subtitle}
          </div>
        )}

        {/* 本体 */}
        <div className="flex-1 overflow-auto px-4 py-3">
          {loading ? (
            <div className="text-2xs text-ink-muted">読込中…</div>
          ) : errorMsg ? (
            <div className="bg-red-950/40 border border-status-error/40 rounded p-3 text-2xs text-status-error">
              ⚠ {errorMsg}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-2xs text-ink-muted text-center py-6">
              {emptyHint ?? '該当データがありません'}
            </div>
          ) : (
            <div className="border border-surface-border rounded overflow-auto">
              <table className="w-full text-2xs">
                <thead className="bg-surface-base sticky top-0 border-b border-surface-border">
                  <tr>
                    {cols.map((c, i) => {
                      const sample = rows[0]?.[i];
                      const numCol = isNumLike(sample);
                      return (
                        <th
                          key={i}
                          className={`px-1.5 py-1.5 text-3xs uppercase text-ink-subtle font-bold ${
                            numCol ? 'text-right' : 'text-left'
                          }`}
                        >
                          {c}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={`border-t border-surface-border ${
                        onRowClick ? 'cursor-pointer hover:bg-blue-950/30' : ''
                      }`}
                    >
                      {row.map((cell, cIdx) => {
                        const numCell = isNumLike(cell);
                        const isCode = codeFirstCol && cIdx === 0;
                        return (
                          <td
                            key={cIdx}
                            className={`px-1.5 py-1 ${
                              isCode
                                ? 'font-mono text-blue-300'
                                : numCell
                                  ? 'text-right tabular-nums font-mono'
                                  : ''
                            }`}
                          >
                            {cell ?? '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* フッタ */}
        <div className="px-4 py-2 border-t border-surface-border bg-surface-panel flex items-center justify-end gap-2 text-2xs text-ink-muted">
          <span>{rows.length.toLocaleString()} 件表示</span>
          <button
            onClick={onClose}
            className="ml-2 px-3 py-1 rounded border border-surface-border bg-surface-base hover:bg-surface-raised text-ink"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
