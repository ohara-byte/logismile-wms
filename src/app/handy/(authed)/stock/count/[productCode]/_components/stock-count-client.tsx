'use client';

/**
 * 在庫検品クライアント（Sprint Z-2 リワーク）
 *
 * 仕様:
 *  1. 発送対象日付セレクタ（デフォルト当日、前後選択可）
 *  2. JAN/商品コードスキャン → 必要数を大表示
 *  3. 連続入力時の加算式（数字キーを押すたび qty に+追加）
 *  4. 完了時の確認モーダル（不足/超過を可視化）
 *  5. 完了後 3.5 秒で自動遷移（メニューへ）/Enter 即時遷移
 *  6. 完了画面の色：
 *      100% 引当 = 青ベタ
 *      不足     = 黄ベタ
 *      超過     = 赤ベタ（エラー）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useHardwareKeys } from '@/lib/use-hardware-keys';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';

interface RequiredData {
  productCode: string;
  productName: string;
  productJan: string | null;
  productType: string;
  /** A：発送可能賞味期限（日数）。入庫検品完了後バナー（入庫日+日数-1）で使用。null ならバナー非表示。 */
  shippableExpiryDays: number | null;
  targetDate: string;
  stock: { qty: number; allocatedQty: number; availableQty: number };
  requiredQty: number;
  allocatedQty: number;
  stillNeed: number;
  shortageQty: number;
  orderCount: number;
}

interface AllocationRunResult {
  triggered: number;
  allocated: number;
  shortages: Array<{ pkNo: string; productCode: string; shortageQty: number }>;
  draftInstructions: number;
}

interface CompleteState {
  qtyBefore: number;
  countedQty: number;
  qtyAfter: number;
  requiredQty: number;
  allocatedAfter: number;
  shortageAfter: number;
  status: 'full' | 'short' | 'over';
  allocResult?: AllocationRunResult;
}

interface Props {
  productCode: string;
}

const AUTO_REDIRECT_MS = 3500;

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * A：発送可能賞味期限日を「入庫日（=本日）＋日数−1」で算出し「〇月〇日」表記で返す。
 * 例）本日6/12・日数30 → 6/12 を1日目として 30日目＝7/11。
 */
function shippableExpiryLabel(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days - 1);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function StockCountClient({ productCode }: Props) {
  const router = useRouter();
  const [targetDate, setTargetDate] = useState<string>(todayStr());
  const [data, setData] = useState<RequiredData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countedQty, setCountedQty] = useState(0);
  const [buf, setBuf] = useState('');
  const [completed, setCompleted] = useState<CompleteState | null>(null);
  // A：検品完了後、発送可能賞味期限バナーを☑するまで完了画面（と自動遷移）を保留
  const [expiryConfirmed, setExpiryConfirmed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A：発送可能賞味期限の確認バナーを出すべきか（完了済 & 日数あり & 未確認）
  const needsExpiryConfirm =
    !!completed && data?.shippableExpiryDays != null && !expiryConfirmed;

  const load = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/stocks/required?productCode=${encodeURIComponent(productCode)}&date=${targetDate}`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j.data as RequiredData);
    } catch (e) {
      setError(String(e));
    }
  }, [productCode, targetDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (data && !completed) inputRef.current?.focus();
  }, [data, completed]);

  // 完了画面の自動遷移（A：賞味期限バナー確認待ちの間は遷移しない）
  useEffect(() => {
    if (!completed || needsExpiryConfirm) return;
    const id = setTimeout(() => router.push('/handy/stock'), AUTO_REDIRECT_MS);
    return () => clearTimeout(id);
  }, [completed, needsExpiryConfirm, router]);

  function commitBuffer() {
    if (buf === '') return;
    const n = parseInt(buf, 10);
    if (!Number.isFinite(n) || n < 0) {
      setBuf('');
      return;
    }
    setCountedQty((prev) => prev + n);
    setBuf('');
  }

  function pushDigit(d: number) {
    if (completed) return;
    setBuf((prev) => {
      if (prev.length >= 5) return prev;
      const next = (prev === '0' ? '' : prev) + String(d);
      return next;
    });
  }

  async function submit() {
    if (!data) return;
    let total = countedQty;
    if (buf !== '') {
      const n = parseInt(buf, 10);
      if (Number.isFinite(n) && n >= 0) total += n;
    }
    if (total <= 0) {
      setError('カウント値を入力してください（数字キー → Enter で加算）');
      return;
    }
    setBusy(true);
    setError(null);

    const qtyBefore = data.stock.qty;
    const newQty = qtyBefore + total;

    try {
      const r = await fetch('/api/stocks/count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productCode: data.productCode,
          qty: newQty,
          note: `加算 +${total}`,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.message ?? `HTTP ${r.status}`);
        setBusy(false);
        return;
      }
      const qtyAfter = (j.data?.qty as number) ?? newQty;

      // 引当ラン
      let allocResult: AllocationRunResult | undefined;
      try {
        const ar = await fetch(
          `/api/allocation/run?productCode=${encodeURIComponent(data.productCode)}&shipDate=${data.targetDate}`,
          { method: 'POST' },
        );
        if (ar.ok) {
          const aj = await ar.json();
          allocResult = aj.data as AllocationRunResult;
        }
      } catch {
        /* noop */
      }

      // 結果再取得
      const after = await fetch(
        `/api/stocks/required?productCode=${encodeURIComponent(data.productCode)}&date=${data.targetDate}`,
      );
      let allocatedAfter = data.allocatedQty + total;
      let shortageAfter = data.shortageQty;
      if (after.ok) {
        const aj = await after.json();
        allocatedAfter = aj.data?.allocatedQty ?? allocatedAfter;
        shortageAfter = aj.data?.shortageQty ?? shortageAfter;
      }

      // ステータス判定
      const requiredQty = data.requiredQty;
      // 投入合計が「これから必要な数」を超えたら超過扱い
      const stillNeedBefore = Math.max(requiredQty - data.allocatedQty, 0);
      let status: 'full' | 'short' | 'over' = 'full';
      if (total > stillNeedBefore) {
        status = 'over';
      } else if (allocatedAfter < requiredQty) {
        status = 'short';
      }

      setCompleted({
        qtyBefore,
        countedQty: total,
        qtyAfter,
        requiredQty,
        allocatedAfter,
        shortageAfter,
        status,
        allocResult,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Sprint Z-7: Enter キーは input にフォーカスがある状態でも確実に動くよう
  //   入力欄の onKeyDown と useHardwareKeys 両方から呼ぶ共通ハンドラに切出し。
  function handleEnterKey() {
    // A：賞味期限バナー表示中は Enter で☑（確認）→ 完了画面へ
    if (needsExpiryConfirm) {
      setExpiryConfirmed(true);
      return;
    }
    if (completed) {
      router.push('/handy/stock');
      return;
    }
    if (buf !== '') {
      commitBuffer();
    } else if (countedQty > 0) {
      void submit();
    }
  }

  useHardwareKeys({
    onDigit: (d) => pushDigit(d),
    onBackspace: () => {
      if (!completed) setBuf((b) => b.slice(0, -1));
    },
    onClear: () => {
      if (!completed) {
        setBuf('');
        setCountedQty(0);
      }
    },
    onEnter: handleEnterKey,
    onTrigger: () => {
      // A：賞味期限バナー表示中はトリガーで☑（確認）→ 完了画面へ
      if (needsExpiryConfirm) {
        setExpiryConfirmed(true);
        return;
      }
      if (completed) {
        router.push('/handy/stock');
        return;
      }
      if (buf !== '') commitBuffer();
      if (countedQty > 0) void submit();
    },
    onEscape: () => router.push('/handy/stock'),
    onF2: () => router.push('/handy/stock'),
    // Sprint Z-7: F3 トグル（在庫検品 ⇔ ピッキング）— 待機画面の F3 と対称に動作
    onF3: () => router.push('/handy'),
  });

  if (!data && !error) {
    return (
      <main className="min-h-screen bg-surface-base text-ink p-4">
        <div className="text-sm text-ink-muted">読み込み中…</div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="min-h-screen bg-surface-base text-ink p-4">
        <header className="mb-3">
          <LogiSmileLogo height={16} />
        </header>
        <div className="text-sm bg-status-error-bg text-status-error border border-status-error rounded p-3">
          ⚠ {error}
        </div>
        <button
          onClick={() => router.push('/handy/stock')}
          className="mt-4 w-full bg-surface-panel border border-surface-border rounded-lg py-2.5 text-sm font-bold"
        >
          メニューに戻る (Esc)
        </button>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────
  // A：発送可能賞味期限バナー（検品完了後・☑するまで完了画面へ進めない）
  // ─────────────────────────────────────────────────────
  if (needsExpiryConfirm && data && data.shippableExpiryDays != null) {
    const days = data.shippableExpiryDays;
    const label = shippableExpiryLabel(days);
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
        style={{ background: 'linear-gradient(135deg, #b45309, #78350f)', color: '#fff', gap: 16 }}
      >
        <div style={{ fontSize: 96, lineHeight: 1 }}>📅</div>
        <h1 className="text-lg font-bold" style={{ color: '#fde68a' }}>
          発送可能賞味期限
        </h1>
        <div className="text-5xl font-bold tabular-nums" style={{ lineHeight: 1.1 }}>
          {label}
          <span className="text-2xl font-bold"> 以降</span>
        </div>
        <p className="text-xs" style={{ color: '#fde68a', opacity: 0.9 }}>
          入庫日 + {days}日 − 1 で算出
        </p>
        <p className="text-sm font-mono mt-1" style={{ color: '#fde68a' }}>
          {data.productCode}
        </p>
        <p className="text-xs" style={{ color: '#fde68a', opacity: 0.9 }}>
          {data.productName}
        </p>

        <button
          type="button"
          onClick={() => setExpiryConfirmed(true)}
          className="mt-4 w-full max-w-xs rounded-xl py-4 text-lg font-bold"
          style={{ background: '#fff', color: '#78350f' }}
          autoFocus
        >
          確認 ☑
        </button>
        <p className="text-3xs animate-pulse" style={{ color: '#fde68a', opacity: 0.8 }}>
          Enter / トリガー で確認 → 検品完了
        </p>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────
  // 完了画面（青/黄/赤 ベタ）
  // ─────────────────────────────────────────────────────
  if (completed) {
    const tone = completed.status;
    const bg =
      tone === 'full'
        ? 'linear-gradient(135deg, #1d4ed8, #1e3a8a)'
        : tone === 'short'
          ? 'linear-gradient(135deg, #b45309, #78350f)'
          : 'linear-gradient(135deg, #b91c1c, #7f1d1d)';
    const icon = tone === 'full' ? '✓' : tone === 'short' ? '⚠' : '✗';
    const headline =
      tone === 'full'
        ? '引当 100% 達成'
        : tone === 'short'
          ? '不足あり（製造指示生成）'
          : '超過（要確認）';
    const headColor =
      tone === 'full' ? '#dbeafe' : tone === 'short' ? '#fde68a' : '#fecaca';

    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
        style={{ background: bg, color: '#fff', gap: 14 }}
      >
        <div style={{ fontSize: 130, lineHeight: 1, color: '#fff' }}>{icon}</div>
        <h1 className="text-2xl font-bold">{headline}</h1>
        <p className="text-sm font-mono" style={{ color: headColor }}>
          {data?.productCode}
        </p>
        <p className="text-xs" style={{ color: headColor, opacity: 0.9 }}>
          {data?.productName}
        </p>

        <div
          className="rounded-lg px-4 py-3 mt-2"
          style={{
            background: 'rgba(0,0,0,0.3)',
            color: '#fff',
            minWidth: 280,
          }}
        >
          <div className="grid grid-cols-3 gap-2 text-center text-2xs">
            <div>
              <div className="opacity-75">必要</div>
              <div className="text-xl font-bold tabular-nums font-mono">
                {completed.requiredQty}
              </div>
            </div>
            <div>
              <div className="opacity-75">投入</div>
              <div className="text-xl font-bold tabular-nums font-mono">
                +{completed.countedQty}
              </div>
            </div>
            <div>
              <div className="opacity-75">引当済</div>
              <div className="text-xl font-bold tabular-nums font-mono">
                {completed.allocatedAfter}
              </div>
            </div>
          </div>
          {tone === 'short' && (
            <div className="text-2xs mt-2 leading-relaxed">
              ⚠ 不足 <b className="text-lg">{completed.shortageAfter}</b> 個
              {completed.allocResult &&
                completed.allocResult.draftInstructions > 0 && (
                  <>
                    {' '}
                    ／ 製造指示 draft{' '}
                    {completed.allocResult.draftInstructions} 件作成
                  </>
                )}
            </div>
          )}
          {tone === 'over' && (
            <div className="text-2xs mt-2 leading-relaxed">
              ✗ 投入数（{completed.countedQty}）が必要数（
              {completed.requiredQty}）を超過しています
            </div>
          )}
        </div>

        <p className="text-xs animate-pulse mt-2" style={{ color: headColor }}>
          Enter / トリガー で次の商品へ
        </p>
        <p className="text-3xs" style={{ color: headColor, opacity: 0.7 }}>
          {Math.round(AUTO_REDIRECT_MS / 1000)} 秒後に自動でメニューへ戻ります
        </p>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────
  // 数量入力画面
  // ─────────────────────────────────────────────────────
  const inputBufVal = buf !== '' ? parseInt(buf, 10) || 0 : 0;
  const stillNeedBefore = Math.max(
    (data?.requiredQty ?? 0) - (data?.allocatedQty ?? 0),
    0,
  );
  const overInput = countedQty + inputBufVal > stillNeedBefore;

  return (
    <main className="min-h-screen bg-surface-base text-ink p-3 flex flex-col">
      <header className="mb-2 flex items-center gap-2">
        <LogiSmileLogo height={16} />
        <span className="text-3xs text-ink-muted">在庫検品</span>
        <div className="flex-1" />
        <button
          onClick={() => router.push('/handy/stock')}
          className="text-3xs text-ink-subtle hover:text-status-error"
          aria-label="閉じる"
        >
          ✕ 中止
        </button>
      </header>

      {/* 出荷日 */}
      <div className="bg-surface-panel border border-surface-border rounded-lg p-2 mb-2 flex items-center gap-2">
        <span className="text-3xs text-ink-subtle uppercase">出荷日</span>
        <button
          type="button"
          onClick={() => setTargetDate((d) => shiftDate(d, -1))}
          className="px-2 py-1 rounded bg-surface-base border border-surface-border text-xs"
        >
          ◀
        </button>
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="flex-1 bg-surface-base border border-surface-border rounded px-2 py-1 text-sm font-mono"
        />
        <button
          type="button"
          onClick={() => setTargetDate((d) => shiftDate(d, 1))}
          className="px-2 py-1 rounded bg-surface-base border border-surface-border text-xs"
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => setTargetDate(todayStr())}
          className="px-2 py-1 rounded bg-blue-900 border border-blue-600 text-xs"
        >
          今日
        </button>
      </div>

      {/* 商品 */}
      <div className="bg-surface-panel border border-surface-border rounded-lg p-2.5 mb-2">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className={
              data?.productType === 'pass_through'
                ? 'text-3xs px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-200 font-bold'
                : data?.productType === 'made_to_order'
                  ? 'text-3xs px-1.5 py-0.5 rounded bg-amber-950 text-accent-amber font-bold'
                  : 'text-3xs px-1.5 py-0.5 rounded bg-surface-base text-ink-subtle font-bold'
            }
          >
            {data?.productType === 'pass_through'
              ? '通過型'
              : data?.productType === 'made_to_order'
                ? '受注生産'
                : '倉庫在庫'}
          </span>
          <span className="text-3xs text-ink-muted">
            {data?.orderCount ?? 0} 伝票
          </span>
        </div>
        <div className="text-sm font-bold text-ink-strong leading-tight">
          {data?.productName}
        </div>
        <div className="text-3xs font-mono text-ink-muted">
          {data?.productCode}
          {data?.productJan && ` / JAN ${data.productJan}`}
        </div>
      </div>

      {/* 必要数 大表示（Sprint Z-4: 母数=残数（再検品考慮）/ 当日必要合計は下欄） */}
      {(() => {
        const required = data?.requiredQty ?? 0;
        const allocated = data?.allocatedQty ?? 0;
        // 残数（このセッション開始前の still need）= 母数
        const denom = Math.max(required - allocated, 0);
        // このセッションでの投入数（合計 + 入力中）= 分子
        const numer = countedQty + inputBufVal;
        // 進捗
        const ratio = denom > 0 ? Math.min((numer / denom) * 100, 999) : numer > 0 ? 999 : 0;
        const fillRatio = Math.min(ratio, 100);
        const stillNeed = Math.max(denom - numer, 0);
        const allDone = denom === 0 && numer === 0;
        const sessionDone = denom > 0 && numer >= denom;

        return (
          <div
            className="rounded-lg p-3 mb-2"
            style={{
              background:
                allDone
                  ? 'linear-gradient(135deg, #064e3b, #047857)' // 既に完了
                  : sessionDone && !overInput
                    ? 'linear-gradient(135deg, #1e3a8a, #1d4ed8)' // 完了
                    : overInput
                      ? 'linear-gradient(135deg, #7f1d1d, #b91c1c)' // 超過
                      : 'linear-gradient(135deg, #422006, #b45309)', // 不足
              color: '#fff',
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-3xs uppercase tracking-wider opacity-80">
                引当進捗（出荷日 {data?.targetDate}）
              </span>
              <span className="text-3xs opacity-80">
                {data?.orderCount ?? 0} 伝票
              </span>
            </div>

            {allDone ? (
              <div
                className="text-center font-bold tabular-nums font-mono mb-1"
                style={{ fontSize: 36, lineHeight: 1.1 }}
              >
                ✓ 引当完了済
                <div className="text-xs font-normal opacity-80 mt-1">
                  既に必要数 {required} 個が引当済です
                </div>
              </div>
            ) : (
              <>
                {/* 大きい「●/●個」表示。母数は残数（このセッション開始時点の不足）*/}
                <div className="flex items-baseline justify-center gap-1 mb-1.5">
                  <span
                    className="font-bold tabular-nums font-mono"
                    style={{ fontSize: 56, lineHeight: 1 }}
                  >
                    {numer}
                  </span>
                  <span
                    className="font-mono opacity-80"
                    style={{ fontSize: 24, lineHeight: 1 }}
                  >
                    /
                  </span>
                  <span
                    className="font-bold tabular-nums font-mono opacity-90"
                    style={{ fontSize: 32, lineHeight: 1 }}
                  >
                    {denom}
                  </span>
                  <span className="text-xs opacity-80 ml-1">個</span>
                  <span className="ml-2 text-2xs opacity-80 tabular-nums">
                    ({Math.round(ratio)}%)
                  </span>
                </div>

                {/* 進捗バー */}
                <div
                  className="h-3 rounded-full overflow-hidden"
                  style={{ background: 'rgba(0,0,0,0.4)' }}
                >
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${fillRatio}%`,
                      background: overInput
                        ? '#fecaca'
                        : sessionDone
                          ? '#86efac'
                          : '#fde68a',
                    }}
                  />
                </div>

                {/* 残（主役）*/}
                <div className="flex items-baseline justify-between mt-2">
                  <span className="text-2xs opacity-90">
                    残{' '}
                    <b className="text-2xl tabular-nums font-mono">
                      {stillNeed}
                    </b>
                    <span className="text-3xs ml-0.5">個</span>
                  </span>
                  <span className="text-3xs opacity-75 font-mono">
                    投入合計 {countedQty} / 入力中 +{inputBufVal}
                  </span>
                </div>
              </>
            )}
            {overInput && (
              <div className="text-2xs text-status-error mt-1 font-bold">
                ⚠ 投入数が残数を超過しています
              </div>
            )}

            {/* 当日の内訳（下段） */}
            <div className="mt-2.5 pt-2 border-t border-white/15 grid grid-cols-3 gap-1 text-center">
              <div>
                <div className="text-3xs uppercase opacity-70">必要合計</div>
                <div className="text-sm font-bold tabular-nums font-mono">
                  {required}
                </div>
              </div>
              <div>
                <div className="text-3xs uppercase opacity-70">既存引当</div>
                <div className="text-sm font-bold tabular-nums font-mono">
                  {allocated}
                </div>
              </div>
              <div>
                <div className="text-3xs uppercase opacity-70">残（投入前）</div>
                <div className="text-sm font-bold tabular-nums font-mono">
                  {denom}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 在庫サマリ */}
      <div className="bg-surface-panel border border-surface-border rounded-lg p-2 mb-2 grid grid-cols-3 gap-1 text-center">
        <div>
          <div className="text-3xs text-ink-subtle uppercase">在庫</div>
          <div className="text-sm font-bold tabular-nums font-mono">
            {data?.stock.qty ?? 0}
          </div>
        </div>
        <div>
          <div className="text-3xs text-ink-subtle uppercase">引当済</div>
          <div className="text-sm font-bold tabular-nums font-mono text-accent-amber">
            {data?.stock.allocatedQty ?? 0}
          </div>
        </div>
        <div>
          <div className="text-3xs text-ink-subtle uppercase">利用可</div>
          <div className="text-sm font-bold tabular-nums font-mono text-status-ok">
            {data?.stock.availableQty ?? 0}
          </div>
        </div>
      </div>

      {/* 加算入力 */}
      <div className="flex-1 bg-surface-panel border border-surface-border rounded-lg p-3 flex flex-col items-center justify-center">
        <label className="text-3xs uppercase tracking-wider text-ink-subtle mb-1">
          投入数を加算入力
        </label>
        <div className="flex items-baseline gap-3 mb-2">
          <div>
            <div className="text-3xs text-ink-muted text-center">合計</div>
            <div
              className="font-bold tabular-nums font-mono text-status-ok"
              style={{ fontSize: 48, lineHeight: 1 }}
            >
              {countedQty}
            </div>
          </div>
          <div className="text-2xl text-ink-muted">+</div>
          <div>
            <div className="text-3xs text-ink-muted text-center">入力中</div>
            <div
              className="font-bold tabular-nums font-mono"
              style={{
                fontSize: 48,
                lineHeight: 1,
                color: buf === '' ? '#475569' : '#fbbf24',
              }}
            >
              {buf === '' ? '_' : buf}
            </div>
          </div>
        </div>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoFocus
          value={buf}
          onChange={(e) =>
            setBuf(e.target.value.replace(/\D/g, '').slice(0, 5))
          }
          // Sprint Z-7: input にフォーカスがあると useHardwareKeys の onEnter が
          //   発火しないので、ここで直接 Enter を処理する（ハード Enter / バーコード末尾 Enter 両対応）
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleEnterKey();
            }
          }}
          className="w-full max-w-xs bg-surface-base border-2 border-accent-amber/50 rounded-lg px-3 py-1.5 text-base font-mono text-center mb-2"
          placeholder="数字 → Enter で加算"
        />
        {error && (
          <div className="text-3xs bg-status-error-bg text-status-error border border-status-error/40 rounded p-1.5 mb-2 max-w-xs text-center">
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
          <button
            type="button"
            onClick={commitBuffer}
            disabled={buf === ''}
            className="bg-blue-700 hover:bg-blue-600 text-white rounded-lg py-2 text-xs font-bold border border-blue-500 disabled:opacity-50"
          >
            ＋ 加算 (Enter)
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || countedQty === 0}
            className="bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg py-2 text-xs font-bold border border-emerald-500 disabled:opacity-50"
          >
            {busy ? '送信中…' : '✓ 確定'}
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setCountedQty(0);
            setBuf('');
          }}
          className="text-3xs text-ink-muted mt-2"
        >
          🗑 リセット (Del/Clear)
        </button>
      </div>

      <p className="text-3xs text-ink-muted text-center pt-1.5">
        ⌨ <b>0-9</b> = 入力 / <b>Enter</b> = 加算 → 再 Enter で確定 /{' '}
        <b>トリガー</b> = 即確定 / <b>F2</b> = 戻る /{' '}
        <b className="text-accent-amber">F3</b> = ピッキング / <b>Esc</b> = 中止
      </p>
    </main>
  );
}
