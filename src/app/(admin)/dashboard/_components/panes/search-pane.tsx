'use client';

/**
 * 🔍 検索タブ（ミックス検索）
 *
 * モック準拠（管理用PCモック_v0.22.html L2792-2952）。
 *
 * 構成:
 *   1. 検索範囲ピル（当日 / 翌日 / 前日 / 任意）
 *   2. 動的に追加・削除できる条件行（フィールド select + キーワード input）
 *      14 種類のフィールドを AND 結合
 *   3. ＋条件追加 / クリア / 🔍 検索 ボタン
 *   4. フラグチップ 10 種（すべて/待機/着手中/完了/強制OK/冷凍/特殊/前倒し/繰越/取消）
 *   5. 結果カード一覧（クリック → useOrderDetailModal で詳細モーダル）
 *
 * API: POST /api/orders/search
 */

import { useCallback, useEffect, useState } from 'react';
import { useOrderDetailModal } from '@/components/admin/order-detail-context';

type Field =
  | 'pk_no'
  | 'invoice_no'
  | 'customer'
  | 'customer_code'
  | 'tel'
  | 'product'
  | 'product_code'
  | 'component_name'
  | 'carrier'
  | 'noshi'
  | 'pref'
  | 'ship_date'
  | 'status'
  | 'table';

type Range = 'today' | 'tomorrow' | 'yesterday' | 'custom';
type Flag =
  | 'all'
  | 'wait'
  | 'working'
  | 'done'
  | 'alert'
  | 'cool'
  | 'special'
  | 'early'
  | 'carry'
  | 'cancel';

interface Condition {
  id: number;
  field: Field;
  value: string;
}

interface SearchResult {
  pkNo: string;
  prefix: string | null;
  status: string;
  deleted: boolean;
  destName: string | null;
  destAddr: string | null;
  carrier: { code: string; name: string; short: string | null; cool: boolean } | null;
  flags: string[];
  forceReasonCode: string | null;
  inspStaff: { code: string; name: string } | null;
  deviceLocation: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

const FIELD_LABEL: Record<Field, string> = {
  pk_no: '📋 ピッキングNo',
  invoice_no: '📄 納品書No',
  customer: '顧客名',
  customer_code: '顧客コード',
  tel: '電話番号',
  product: '構成商品名',
  product_code: '構成商品コード',
  component_name: '📦 セット展開構成商品名',
  carrier: '運送会社',
  noshi: 'のし種類',
  pref: '都道府県',
  ship_date: '発送予定日',
  status: '状態',
  table: 'グループ/テーブル',
};

const RANGE_LABEL: Record<Range, (today: Date) => string> = {
  today: (d) => `当日（${monthDay(d)} ${weekday(d)}）`,
  tomorrow: (d) => {
    const t = new Date(d);
    t.setDate(t.getDate() + 1);
    return `翌日（${monthDay(t)} ${weekday(t)}）`;
  },
  yesterday: (d) => {
    const t = new Date(d);
    t.setDate(t.getDate() - 1);
    return `前日（${monthDay(t)} ${weekday(t)}）`;
  },
  custom: () => '任意…',
};

const FLAG_LABEL: Record<Flag, string> = {
  all: 'すべて',
  wait: '待機',
  working: '着手中',
  done: '完了',
  alert: '⚠ 強制OK',
  cool: '❄ 冷凍',
  special: '★ 特殊梱包',
  early: '🟣 前倒し',
  carry: '🟠 繰越',
  cancel: '❌ 取消',
};

let nextId = 1;
const newCondition = (field: Field): Condition => ({ id: nextId++, field, value: '' });

export function SearchPane() {
  const today = new Date();
  const [range, setRange] = useState<Range>('today');
  const [customDate, setCustomDate] = useState(today.toISOString().slice(0, 10));
  const [conditions, setConditions] = useState<Condition[]>([newCondition('customer')]);
  const [flag, setFlag] = useState<Flag>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const { open: openDetail } = useOrderDetailModal();

  const doSearch = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/orders/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          range,
          customDate: range === 'custom' ? customDate : undefined,
          conditions: conditions
            .filter((c) => c.value.trim().length > 0)
            .map((c) => ({ field: c.field, value: c.value.trim() })),
          flag,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.message ?? `HTTP ${r.status}`);
        return;
      }
      setResults(j.data?.items ?? []);
      setHasSearched(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [range, customDate, conditions, flag]);

  // フラグだけ変えたら自動再検索（モック挙動）
  useEffect(() => {
    if (hasSearched) doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag]);

  function addCondition() {
    if (conditions.length >= 10) return;
    setConditions((prev) => [...prev, newCondition('product')]);
  }

  function removeCondition(id: number) {
    setConditions((prev) => prev.filter((c) => c.id !== id));
  }

  function updateCondition(id: number, patch: Partial<Condition>) {
    setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function clearAll() {
    setConditions([newCondition('customer')]);
    setResults([]);
    setHasSearched(false);
    setError(null);
  }

  return (
    // ① 見出し固定: 絞り込みバー（範囲ピル/ミックス検索/フラグ/件数）は上部固定し、結果リストだけをスクロール。
    <div className="flex flex-col h-full min-h-0">
    <div className="p-3 pb-2 shrink-0 border-b border-surface-border">
      {/* 検索範囲ピル — ユーザー要望（2026-05-18）：日付ピル +2px */}
      <div className="flex flex-wrap gap-1.5 items-center mb-2 p-2 bg-surface-base border border-surface-border rounded">
        <span className="text-xs text-ink-subtle mr-1">📅 検索範囲:</span>
        {(['today', 'tomorrow', 'yesterday', 'custom'] as Range[]).map((r) => (
          <RangePill key={r} active={range === r} onClick={() => setRange(r)}>
            {RANGE_LABEL[r](today)}
          </RangePill>
        ))}
        {range === 'custom' && (
          <input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="ml-2 bg-surface-panel border border-surface-border rounded px-2 py-1 text-xs text-ink"
          />
        )}
      </div>

      {/* ミックス検索フォーム — ユーザー要望（2026-05-18）：検索枠 +2px / 高さ調整 */}
      <div className="bg-surface-base border border-surface-border rounded p-2 mb-2">
        <h4 className="text-xs font-bold text-accent-amber mb-1.5">
          🔍 ミックス検索{' '}
          <span className="text-2xs text-ink-muted font-normal">複数条件を AND 結合</span>
        </h4>
        <div className="space-y-1">
          {conditions.map((c) => (
            <div key={c.id} className="flex gap-1">
              <select
                value={c.field}
                onChange={(e) =>
                  updateCondition(c.id, { field: e.target.value as Field })
                }
                className="bg-surface-panel border border-surface-border rounded px-2 py-1.5 text-xs text-ink min-w-[140px]"
              >
                {(Object.keys(FIELD_LABEL) as Field[]).map((f) => (
                  <option key={f} value={f}>
                    {FIELD_LABEL[f]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={c.value}
                onChange={(e) => updateCondition(c.id, { value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doSearch();
                }}
                placeholder={fieldPlaceholder(c.field)}
                className="flex-1 bg-surface-panel border border-surface-border rounded px-2 py-1.5 text-xs text-ink"
              />
              <button
                onClick={() => removeCondition(c.id)}
                disabled={conditions.length === 1}
                className="px-2 rounded border border-surface-border text-ink-subtle hover:text-status-error hover:border-status-error disabled:opacity-30 disabled:cursor-not-allowed"
                title="この条件を削除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 mt-2">
          <button
            onClick={addCondition}
            disabled={conditions.length >= 10}
            className="text-xs px-2.5 py-1 rounded border border-surface-border bg-surface-panel text-ink-subtle hover:text-ink hover:border-accent-amber disabled:opacity-50"
          >
            ＋ 条件追加
          </button>
          <button
            onClick={clearAll}
            className="text-xs px-2.5 py-1 rounded border border-surface-border bg-surface-panel text-ink-subtle hover:text-ink"
          >
            クリア
          </button>
          <div className="flex-1" />
          <button
            onClick={doSearch}
            disabled={busy}
            className="text-sm font-bold px-3.5 py-1 rounded bg-brand-primary text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {busy ? '検索中…' : '🔍 検索'}
          </button>
        </div>
      </div>

      {/* フラグチップ */}
      <div className="flex flex-wrap gap-1 mb-2">
        {(Object.keys(FLAG_LABEL) as Flag[]).map((f) => (
          <FlagChip key={f} active={flag === f} onClick={() => setFlag(f)}>
            {FLAG_LABEL[f]}
          </FlagChip>
        ))}
      </div>

      {/* ヒント行 */}
      <div className="text-[10px] text-ink-muted mb-2">
        検索結果{' '}
        <b className="text-accent-amber">{results.length}</b>件 ／ 💡 PkNo 末尾の{' '}
        <span className="inline-block bg-blue-900 text-white px-1 rounded text-[9px] font-bold tracking-widest">
          ST
        </span>{' '}
        は伝票種別プリフィックス
      </div>

      {error && (
        <div className="mt-2 p-2 text-2xs bg-status-error-bg text-status-error border border-status-error rounded">
          {error}
        </div>
      )}
    </div>

      {/* 結果リスト — ① ここだけがスクロールする */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 pt-2">
        {!hasSearched ? (
          <div className="text-center py-8 text-2xs text-ink-muted">
            条件を入力して検索してください
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-6 text-2xs text-ink-muted">
            該当する伝票がありません
          </div>
        ) : (
          results.map((r) => (
            <SearchCard key={r.pkNo} item={r} onClick={() => openDetail(r.pkNo)} />
          ))
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 部品
// ──────────────────────────────────────────────

function RangePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  // ユーザー要望（2026-05-18）：日付ピル +2px（10→12px）+ 高さ調整
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? 'bg-amber-900 text-amber-100 border-accent-amber font-bold'
          : 'bg-surface-panel text-ink-subtle border-surface-border hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function FlagChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  // ユーザー要望（2026-05-18）：フラグチップ +2px（10→12px）+ 高さ調整
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded border transition-colors ${
        active
          ? 'bg-brand-primary text-white border-brand-primary font-bold'
          : 'bg-surface-panel text-ink-subtle border-surface-border hover:text-ink hover:border-accent-amber'
      }`}
    >
      {children}
    </button>
  );
}

function SearchCard({
  item,
  onClick,
}: {
  item: SearchResult;
  onClick: () => void;
}) {
  // ユーザー要望（2026-05-18）:
  //  - PkNo +1px（12→13px）
  //  - 担当（割当）と 🚚運送会社 を PkNo の右隣に移動 +1px（10→11px）
  //  - 顧客名は +3px（10→13px）でカード高さは維持
  const { color, label } = statusVisual(item.status, item.deleted);
  return (
    <div
      onClick={onClick}
      className="bg-surface-base border border-surface-border rounded mb-1 px-2.5 py-1.5 cursor-pointer hover:bg-surface-raised hover:border-accent-amber transition-colors"
    >
      <div className="flex justify-between items-baseline mb-0.5 gap-2">
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className="text-[13px] font-mono font-bold text-accent-amber tabular-nums shrink-0">
            {item.pkNo.replace(/^[A-Z]{2,4}-?/, '')}
            {item.prefix && (
              <span className="ml-1.5 text-[10px] bg-blue-900 text-white px-1 rounded font-bold tracking-widest">
                {item.prefix.slice(0, 2)}
              </span>
            )}
            {item.flags.includes('cancel') && (
              <span className="ml-1.5 text-[10px] bg-slate-700 text-slate-200 px-1 rounded">
                ❌取消
              </span>
            )}
            {item.flags.includes('cool') && (
              <span className="ml-1.5 text-[10px] bg-cyan-800 text-cyan-100 px-1 rounded">
                ❄
              </span>
            )}
            {item.flags.includes('special') && (
              <span className="ml-1.5 text-[10px] bg-amber-800 text-amber-100 px-1 rounded">
                ★特殊
              </span>
            )}
            {item.flags.includes('force_ok') && (
              <span className="ml-1.5 text-[10px] bg-red-900 text-red-100 px-1 rounded">
                ⚠ 強制OK{item.forceReasonCode ? ` ${item.forceReasonCode}` : ''}
              </span>
            )}
          </span>
          {/* 担当（割当）+ 🚚 運送会社 を PkNo の右に移動 */}
          <span className="text-[11px] text-ink-muted truncate min-w-0">
            {item.deviceLocation && `${item.deviceLocation} ／ `}
            <span className={item.inspStaff ? 'text-ink-subtle' : 'text-ink-muted'}>
              {item.inspStaff?.name ?? '未割当'}
            </span>
            {item.carrier && (
              <span className="ml-1.5">
                🚚 {item.carrier.short ?? item.carrier.name}
              </span>
            )}
          </span>
        </div>
        <span className={`text-[11px] font-bold shrink-0 ${color}`}>{label}</span>
      </div>
      {/* 顧客名 +3px（13px） */}
      <div className="text-[13px] text-ink truncate">
        {item.destName ?? '—'} ／ {item.destAddr ?? '—'}
      </div>
      {/* 時刻のみ右寄せ（割当・運送は上段へ移動済み） */}
      {(item.completedAt || item.startedAt) && (
        <div className="text-[10px] text-ink-muted mt-0.5 text-right font-mono tabular-nums">
          {item.completedAt
            ? `${shortTime(item.completedAt)} 完了`
            : item.startedAt
              ? `${shortTime(item.startedAt)} 着手`
              : ''}
        </div>
      )}
    </div>
  );
}

function statusVisual(
  status: string,
  deleted: boolean,
): { color: string; label: string } {
  if (deleted) return { color: 'text-ink-muted', label: '◯ キャンセル済' };
  switch (status) {
    case 'pending':
      return { color: 'text-ink-muted', label: '◯ 未着手' };
    case 'inspecting':
      return { color: 'text-status-info', label: '🟦 検品中' };
    case 'packed':
      return { color: 'text-status-ok', label: '✅ 完了' };
    case 'shipped':
      return { color: 'text-status-ok', label: '✅ 出荷済' };
    case 'held':
      return { color: 'text-status-warn', label: '⏸ 保留' };
    default:
      return { color: 'text-ink-subtle', label: status };
  }
}

function fieldPlaceholder(field: Field): string {
  switch (field) {
    case 'pk_no':
      return '例: STC-20260423';
    case 'invoice_no':
      return '例: 12345';
    case 'customer':
      return '例: 佐々木';
    case 'product':
    case 'component_name':
      return '例: ソーセージ';
    case 'product_code':
      return '例: F-SS-2024';
    case 'carrier':
      return '例: ヤマト';
    case 'pref':
      return '例: 鳥取';
    case 'ship_date':
      return 'YYYY-MM-DD or MM-DD';
    case 'status':
      return '未着手 / 検品中 / 完了 / 保留';
    default:
      return 'キーワード';
  }
}

function monthDay(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function weekday(d: Date): string {
  return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
