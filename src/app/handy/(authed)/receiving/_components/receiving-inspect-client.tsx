'use client';

/**
 * ハンディ 発送日別 受入検品クライアント（Phase 5）。
 *  発送日を選び、その日の入庫予定商品（クラフトスマイル発送予定）ごとに検品実数を記録する。
 *  記録は POST /api/handy/receiving-inspect → inspection_count(ship_date+inspectedQty)。
 *  検品照合グリッド④⑧の集計元。
 *
 *  基本フロー（現場の運用に合わせスキャン主導）:
 *    ① バーコード（JAN or 商品コード）をスキャン → 一覧内の該当商品を自動特定
 *    ② 該当行へスクロール＆ハイライト、検品数欄へフォーカス
 *    ③ 今回数えた数を入力して「追加」（Enter でも可）→ スキャン入力へフォーカス復帰
 *  ※ スキャンせず目視で探して手入力する従来操作も併用可。
 *
 *  ★ 2026-08-26（現場要望「改修要望書」B案）: 上書き → 加算へ変更
 *    旧仕様は「記録／修正」の1ボタンで、既に検品済みの商品へ再登録すると
 *    **先の検品数を単純に上書き**していた。そのため
 *      ・複数ハンディで同一商品を検品すると先の分が消える
 *      ・不足分の追加運搬のたびに、画面の数を目視で足してから入力する必要がある
 *    という事故と手間が発生していた。
 *
 *    そこで操作を2つに分離した。
 *      「追加」… 常に加算（日常運用）。入力欄は毎回空で始める。
 *      「訂正」… 既存値を上書き（誤入力を正すときだけ・確認ダイアログあり）。
 *
 *    ※ 入力欄に検品済み数を初期表示しないのは、加算では二重計上になるため。
 *
 *  ★ 2026-08-27（CraftSmile スマホ納品送信との連携）: ラベルQR に対応
 *    CraftSmile がスマホから納品送信すると、1商品1枚のラベルを印刷する。
 *    そのQR（`CS1|発送日|商品コード|数量|連番`）を読むと、
 *      ・商品を特定する（JAN が無い商品でも特定できる）
 *      ・**検品数の初期値をラベルの数量で埋める**（今回運ばれてきた分が分かる）
 *    ため、現場は「読む→追加」だけで済む。手入力の必要がなくなる。
 *
 *    同じラベルを二度読んだ場合は連番で検知して警告する（二重計上の防止）。
 *    従来の JAN／商品コードのスキャンはそのまま使える。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useScanSound } from '@/lib/use-scan-sound';
import {
  resolveQtyPrefill,
  validateInspectInput,
  type InspectMode,
} from '@/lib/receiving-inspect';
import {
  resolveScan,
  labelKey,
  resolveQtyPrefillFromLabel,
} from '@/lib/receiving-scan';

type PickItem = {
  productCode: string;
  productName: string | null;
  productionDeptName: string | null;
  jan: string | null;
  /** ②使用期限：発送可能賞味期限(日数)。在庫検品バナーと同じ源。null なら表示しない。 */
  shippableExpiryDays: number | null;
  plannedQty: number;
  confirmedQty: number | null;
  deliveredQty: number;
  inspectedQty: number;
};

/**
 * ②使用期限：発送可能賞味期限日を「入庫日（=本日）＋日数−1」で算出し「M月D日」表記で返す。
 * 在庫検品バナーの shippableExpiryLabel と同一ロジック（例 本日+4日 → 7/16）。
 */
function shippableExpiryLabel(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days - 1);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

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
  const [scanInput, setScanInput] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  // 読んだラベルの記録（発送日|商品|連番）。同じラベルの二度読みを検知して二重計上を防ぐ。
  const scannedLabelsRef = useRef<Set<string>>(new Set());
  // 納品パターン：'prev'=前日納品分(④) / 'today'=当日納品分(⑧)。既定 prev（当日納品を検品する時だけ切替）。
  const [pattern, setPattern] = useState<'prev' | 'today'>('prev');

  const { playBeep, playError } = useScanSound();
  const scanInputRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const focusScan = useCallback(() => {
    // レンダー確定後にフォーカスを戻す（連続スキャンのため）
    requestAnimationFrame(() => scanInputRef.current?.focus());
  }, []);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/handy/pick-list?shipDate=${date}&pattern=${pattern}`);
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
  }, [date, pattern]);

  useEffect(() => {
    void reload();
    setInputs({});
    setSelectedCode(null);
    // 発送日・パターンを変えたら別の納品なので、読み込み済みラベルの記録も捨てる
    scannedLabelsRef.current = new Set();
  }, [reload]);

  // 一覧読込後はスキャン待受にフォーカス
  useEffect(() => {
    if (!busy && items.length > 0) focusScan();
  }, [busy, items.length, focusScan]);


  /** 該当行へスクロールし、数量欄へフォーカスする。 */
  const focusRow = (productCode: string) => {
    requestAnimationFrame(() => {
      const el = qtyRefs.current[productCode];
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
      el?.select();
    });
  };

  const onScan = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = scanInput.trim();
    setScanInput('');
    if (!raw) {
      focusScan();
      return;
    }

    const res = resolveScan(raw, items);

    // ── CraftSmile のラベルQR ──
    if (res.kind === 'label_not_in_list') {
      playError();
      setSelectedCode(null);
      setFlash(
        `⚠ この発送日の予定に無い商品です: ${res.label.productCode}（ラベルの発送日 ${res.label.shipDate}）`,
      );
      focusScan();
      return;
    }
    if (res.kind === 'label') {
      const { item, label } = res;
      const key = labelKey(label);
      // ★ 同じラベルの二度読みは弾く。「追加」は加算なので、読むたびに足されてしまう。
      if (scannedLabelsRef.current.has(key)) {
        playError();
        setSelectedCode(item.productCode);
        setFlash(
          `⚠ このラベルは既に読み込み済みです（${item.productName ?? item.productCode} ${label.qty}／連番${label.serial}）。別のラベルをお読みください`,
        );
        focusScan();
        return;
      }
      scannedLabelsRef.current.add(key);
      playBeep();
      setSelectedCode(item.productCode);
      // ★ ラベルは「今回運ばれてきた分」が分かるので、その数量を初期値にする。
      //   手入力時に空欄にしていたのは今回分が不明だったためで、ラベルなら不要。
      setInputs((prev) => ({
        ...prev,
        [item.productCode]: resolveQtyPrefillFromLabel({
          current: prev[item.productCode],
          label,
        }),
      }));
      setFlash(
        `▶ ${item.productName ?? item.productCode}：ラベル ${label.qty} を読み取りました。「追加」で確定してください`,
      );
      focusRow(item.productCode);
      return;
    }

    // ── 従来のバーコード（JAN／商品コード）──
    if (res.kind === 'unknown') {
      playError();
      setSelectedCode(null);
      setFlash(`⚠ 予定外/未登録のバーコード: ${raw}`);
      focusScan();
      return;
    }
    const hit = res.item;
    playBeep();
    setSelectedCode(hit.productCode);
    // 検品数の初期値（未入力の場合のみ。編集中の値は尊重する）
    //   ・未検品          → 納品数を初期表示（全数検品が通常のため）
    //   ・既に検品済み    → **空**。「追加」は加算なので納品数を入れると二重計上になる
    //                       （2026-08-26 B案。今回運ばれてきた分だけを入力させる）
    setInputs((prev) => ({
      ...prev,
      [hit.productCode]: resolveQtyPrefill({
        current: prev[hit.productCode],
        inspectedQty: hit.inspectedQty,
        deliveredQty: hit.deliveredQty,
      }),
    }));
    setFlash(
      hit.inspectedQty > 0
        ? `▶ ${hit.productName ?? hit.productCode}：検品済み ${hit.inspectedQty}。今回数えた数を入力して追加`
        : `▶ ${hit.productName ?? hit.productCode}：数量を確認して追加`,
    );
    focusRow(hit.productCode);
  };

  /**
   * 検品数を記録する。
   * @param mode 'add'=加算（追加ボタン・Enter）／'set'=上書き（訂正ボタン）
   */
  const record = async (it: PickItem, mode: InspectMode) => {
    const v = validateInspectInput({ raw: inputs[it.productCode], mode });
    if (!v.ok) {
      playError();
      setFlash(`⚠ ${it.productName ?? it.productCode}: ${v.message}`);
      return;
    }
    const qty = v.qty;
    // 訂正は既存値を書き換える操作なので、取り違え防止に確認を挟む
    if (mode === 'set') {
      const name = it.productName ?? it.productCode;
      if (!confirm(`${name}\n\n検品済み ${it.inspectedQty} → ${qty} に訂正します。\nよろしいですか？`)) {
        return;
      }
    }
    setSavingCode(it.productCode);
    try {
      const r = await fetch('/api/handy/receiving-inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipDate: date,
          productCode: it.productCode,
          inspectedQty: qty,
          pattern,
          mode,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        playError();
        setFlash(`⚠ ${j?.message ?? `HTTP ${r.status}`}`);
        return;
      }
      // 反映後の合計はサーバが返す（加算の計算を画面側で持たない）
      const total: number = typeof j?.data?.totalQty === 'number' ? j.data.totalQty : qty;
      setItems((prev) =>
        prev.map((p) => (p.productCode === it.productCode ? { ...p, inspectedQty: total } : p)),
      );
      setInputs((prev) => ({ ...prev, [it.productCode]: '' }));
      setSelectedCode(null);
      setFlash(
        mode === 'add'
          ? `✓ ${it.productName ?? it.productCode}: +${qty} → 検品済み ${total}`
          : `✎ ${it.productName ?? it.productCode}: 検品済み ${total} に訂正`,
      );
      // 次のスキャンへ待受を戻す
      focusScan();
    } catch (e) {
      playError();
      setFlash(`⚠ ${String(e)}`);
    } finally {
      setSavingCode(null);
    }
  };

  const doneCount = items.filter((it) => it.inspectedQty > 0).length;

  return (
    <div className="flex-1 flex flex-col p-2 gap-2 overflow-y-auto">
      {/* 納品パターン選択：どの納品分を検品しているか（前日納品分=④ / 当日納品分=⑧）。
          「いつ検品したか」ではなくこの選択で振り分けるので、前日納品分を当日検品しても③との突合(④)に正しく載る。 */}
      <div className="flex items-center gap-1 text-2xs">
        <span className="text-ink-subtle mr-0.5 shrink-0">検品対象:</span>
        {(
          [
            ['prev', '前日納品分'],
            ['today', '当日納品分'],
          ] as const
        ).map(([p, label]) => (
          <button
            key={p}
            type="button"
            onClick={() => setPattern(p)}
            className={`flex-1 px-2 py-1.5 rounded border font-bold ${
              pattern === p
                ? 'border-accent-amber bg-accent-amber text-surface-base'
                : 'border-surface-border bg-surface-panel text-ink-subtle'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

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

      {/* スキャン待受（現場の基本フロー：スキャン→対象確定→数量入力） */}
      <form
        onSubmit={onScan}
        className="shrink-0 rounded border-2 border-accent-amber/50 bg-surface-panel p-2"
      >
        <label className="block text-3xs font-bold mb-1 text-accent-amber">
          🔍 バーコードをスキャン（JAN／商品コード）→ 数量入力へ
        </label>
        <input
          ref={scanInputRef}
          autoFocus
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          className="w-full bg-surface-base border-2 border-accent-amber/50 rounded px-2 py-2 text-base font-mono text-ink-strong tabular-nums focus:outline-none focus:border-accent-amber focus:ring-2 focus:ring-accent-amber/30"
          placeholder="4901234567894"
        />
      </form>

      <div className="text-3xs text-ink-subtle">
        発送日 <b className="text-ink-strong">{date}</b>{' '}
        <b className="text-accent-amber">{pattern === 'today' ? '当日納品分' : '前日納品分'}</b>{' '}
        の入庫予定：{items.length} 品目
        <span className="ml-2">検品済 <b className="text-ink-strong">{doneCount}</b>/{items.length}</span>
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
          const selected = selectedCode === it.productCode;
          return (
            <div
              key={it.productCode}
              className={`rounded border p-2 transition-colors ${
                selected
                  ? 'border-accent-amber bg-accent-amber/10 ring-2 ring-accent-amber/40'
                  : done
                    ? 'border-emerald-600/50 bg-emerald-950/20'
                    : 'border-surface-border bg-surface-panel'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  {/* ①現場要望(2026-07-20)：商品名 12px→14px */}
                  <div className="text-sm text-ink-strong truncate">{it.productName ?? '—'}</div>
                  {/* 品番・取引先は補助情報のため 9px 据え置き */}
                  <div className="text-3xs text-ink-muted tabular-nums">
                    {it.productCode}
                    {it.productionDeptName ? `／${it.productionDeptName}` : ''}
                  </div>
                </div>
                {/* ①検品済バッジ 9px→14px（太字・緑は維持） */}
                {done && <span className="text-sm text-emerald-300 font-bold shrink-0">検品済 {it.inspectedQty}</span>}
              </div>
              {/* ①予定・確定・納品＋使用期限を 9px→14px（横並びのまま・入りきらなければ折返し） */}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-ink-subtle tabular-nums">
                <span>予定 <b className="text-ink-strong">{it.plannedQty}</b></span>
                <span>確定 <b className="text-ink-strong">{it.confirmedQty ?? '—'}</b></span>
                <span>納品 <b className="text-ink-strong">{it.deliveredQty}</b></span>
                {it.shippableExpiryDays != null && (
                  <span className="text-amber-300">
                    使用期限{' '}
                    <b className="text-amber-200">{shippableExpiryLabel(it.shippableExpiryDays)}以降</b>
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  ref={(el) => {
                    qtyRefs.current[it.productCode] = el;
                  }}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder={done ? '今回数えた数' : '検品数'}
                  // 2026-08-26（B案）: 検品済み数を初期表示しない。
                  //   「追加」は加算なので、現在値を入れておくと二重計上になる。
                  value={inputs[it.productCode] ?? ''}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [it.productCode]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      // Enter は日常フロー＝加算
                      void record(it, 'add');
                    }
                  }}
                  className="flex-1 bg-surface-base border border-surface-border rounded px-2 py-1.5 text-sm text-ink tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => record(it, 'add')}
                  disabled={savingCode === it.productCode}
                  title={done ? `検品済み ${it.inspectedQty} に加算します` : '検品数を記録します'}
                  className="px-3 py-1.5 rounded bg-accent-amber text-surface-base text-xs font-bold disabled:opacity-50"
                >
                  追加
                </button>
                {/* 訂正＝既存値の上書き。誤入力を正すときだけ使うため、検品済みがある行にのみ出す。 */}
                {done && (
                  <button
                    type="button"
                    onClick={() => record(it, 'set')}
                    disabled={savingCode === it.productCode}
                    title={`検品済み ${it.inspectedQty} を入力値で置き換えます（誤入力の訂正用）`}
                    className="px-2.5 py-1.5 rounded border border-surface-border bg-surface-base text-ink-subtle text-xs font-bold disabled:opacity-50"
                  >
                    訂正
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
