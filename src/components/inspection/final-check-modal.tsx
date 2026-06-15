'use client';

/**
 * 最終チェックモーダル（タブレット / ハンディ共用） — Sprint D-1
 *
 * モック準拠: タブレット検品モック_v0.18.html の `koudokuModal`（L1453-1499）
 *             ハンディ検品モック_v0.14.html  の `koudokuModal`（L1215-1234）
 *
 * 全アイテム検品完了で自動展開（350ms ディレイ）。
 * 構成:
 *   1. 商品検品状況サマリ（行ごとに ✓/◯ + 名称 + done/qty）
 *   2. のし確認 ☑（noshiName がある場合）
 *   3. 同梱指示・同梱物リスト（API /api/orders/[pkNo]/accompanies）
 *   4. 進捗バー（☑済 N / 全 M）
 *   5. 戻る / 納品書をスキャン ボタン（全☑で脈動有効化）
 *
 * 納品書バーコードはモーダル内 input で受け、HID スキャナの Enter で確定。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

interface AccompanyItem {
  id: string;
  type: string;
  name: string;
  packingNote: string | null;
}

interface InspectedItem {
  id: number;
  productName: string;
  qty: number;
  scannedQty: number;
  forceOk: boolean;
  /** 2026-05-31 緊急修正：商品コード（納品書として誤入力された場合に検出） */
  productCode?: string;
  /** 2026-05-31 緊急修正：商品 JAN（同上） */
  productJan?: string | null;
}

interface Props {
  open: boolean;
  pkNo: string;
  noshiName: string | null;
  qrPrintFlag: boolean;
  items: InspectedItem[];
  /**
   * ★ サンドイッチ照合の権威値（取込時に基幹 CSV から保存済みの納品書№）。
   *   null/空 の場合は基幹データ不備として完了をブロックする。
   *   2026-05-31: 商品バーコードで誤完了する不具合の根治。
   */
  expectedInvoiceNo: string | null;
  /** 「納品書をスキャン」または Enter 確定で呼ばれる。引数は読み取った納品書№ */
  onConfirm: (invoiceNo: string) => void | Promise<void>;
  /** 「戻る」「Esc」「背景クリック」で呼ばれる */
  onBack: () => void;
  /** UI 表示モード: tablet=広め / handy=コンパクト */
  variant?: 'tablet' | 'handy';
}

export function FinalCheckModal({
  open,
  pkNo,
  noshiName,
  qrPrintFlag,
  items,
  expectedInvoiceNo,
  onConfirm,
  onBack,
  variant = 'tablet',
}: Props) {
  const [accompanies, setAccompanies] = useState<AccompanyItem[] | null>(null);
  const [packingNote, setPackingNote] = useState<string | null>(null);

  // ☑ 状態：のし + 同梱物 ID
  const [noshiChecked, setNoshiChecked] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // 納品書 input
  const [invoiceInput, setInvoiceInput] = useState('');
  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  /** 2026-05-31: 商品バーコードを納品書として誤読した時のエラー */
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  // open 時に同梱物 fetch + 状態リセット
  useEffect(() => {
    if (!open) return;
    setAccompanies(null);
    setNoshiChecked(false);
    setCheckedIds(new Set());
    setInvoiceInput('');
    setBusy(false);
    setInvoiceError(null);

    let cancelled = false;
    fetch(`/api/orders/${encodeURIComponent(pkNo)}/accompanies`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list: AccompanyItem[] = j.data?.accompanies ?? [];
        // 「のし」タイプは別セクションで表示するので除外
        setAccompanies(list.filter((a) => a.type !== 'noshi'));
        setPackingNote(j.data?.setComp?.packingNote ?? null);
      })
      .catch(() => !cancelled && setAccompanies([]));
    return () => {
      cancelled = true;
    };
  }, [open, pkNo]);

  // open 後に納品書 input にフォーカス
  useEffect(() => {
    if (open) {
      // 少し遅延させてフォーカス（モーダルアニメ後）
      const id = setTimeout(() => invoiceInputRef.current?.focus(), 200);
      return () => clearTimeout(id);
    }
  }, [open]);

  // 進捗計算
  const noshiRequired = !!noshiName;
  const accompaniesArr = accompanies ?? [];
  const totalChecks = (noshiRequired ? 1 : 0) + accompaniesArr.length;
  const checkedCount =
    (noshiRequired && noshiChecked ? 1 : 0) +
    accompaniesArr.filter((a) => checkedIds.has(a.id)).length;
  const allChecked = totalChecks === 0 || checkedCount >= totalChecks;

  // のし・同梱物の確認が全て済んだら、納品書 input へ自動でフォーカスし続ける。
  //   → 「納品書をスキャン」ボタンを毎回タップする手間を無くす（2026-06-15・現場要望①）。
  //   全確認後は他に操作対象が無いため、HID スキャナを直接受けられるよう input にフォーカスを維持する。
  useEffect(() => {
    if (!open || !allChecked || busy) return;
    const focus = () => invoiceInputRef.current?.focus();
    const t = setTimeout(focus, 60);
    const interval = setInterval(() => {
      if (document.activeElement !== invoiceInputRef.current) focus();
    }, 500);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
  }, [open, allChecked, busy]);

  const submit = useCallback(
    async (invoiceNo: string) => {
      if (!allChecked || busy) return;
      const v = invoiceNo.trim();
      if (!v) return;

      // ★★★ サンドイッチ検証の核心（2026-05-31 修正）★★★
      // スキャンされた納品書バーコードが、取込時に保存済みの納品書№
      // （expectedInvoiceNo）と「完全一致」する場合のみ完了を許可する。
      // サーバ側でも権威判定するが、現場 UX のため第一線でも即フィードバック。
      const expected = (expectedInvoiceNo ?? '').trim();

      // ① 基幹データ不備（納品書№未登録）→ 完了ブロック
      if (expected === '') {
        setInvoiceError(
          'この伝票には納品書№が登録されていません。管理者に連絡してください。',
        );
        setInvoiceInput('');
        invoiceInputRef.current?.focus();
        return;
      }

      // ② 完全一致しない → 拒否。誤読の種類で親切なメッセージを出し分け
      if (v !== expected) {
        let hint = '納品書№が一致しません。正しい納品書バーコードをスキャンしてください。';
        if (v === pkNo) {
          hint = 'ピッキング№が読まれています。納品書バーコードをスキャンしてください。';
        } else {
          const productMatch = items.find(
            (it) => it.productCode === v || (it.productJan && it.productJan === v),
          );
          if (productMatch) {
            hint = `商品バーコードが読まれています（${productMatch.productName}）。納品書バーコードをスキャンしてください。`;
          }
        }
        setInvoiceError(hint);
        setInvoiceInput('');
        invoiceInputRef.current?.focus();
        return;
      }

      // ③ 完全一致 → 完了
      setInvoiceError(null);
      setBusy(true);
      try {
        await onConfirm(v);
      } finally {
        setBusy(false);
      }
    },
    [allChecked, busy, onConfirm, pkNo, items, expectedInvoiceNo],
  );

  // Esc で戻る + F3 / 矢印 / Enter で同梱物を順次☑（モック L2682-2712 kdkEnterCheck 準拠）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onBack();
        return;
      }
      // 納品書 input にフォーカスがあるときの Enter は通常のフォーム送信に任せる
      const t = e.target as Element | null;
      const inInput =
        !!t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          (t as HTMLElement).isContentEditable);
      // F3 / Right / Enter（input外）= 次の未チェック項目を ☑
      const isStepKey =
        e.key === 'F3' ||
        e.key === 'ArrowRight' ||
        (e.key === 'Enter' && !inInput);
      // Left = 直近☑をオフ
      const isUnstepKey = e.key === 'ArrowLeft';
      if (!isStepKey && !isUnstepKey) return;

      // のし → 同梱物 の順で ☑ する
      const orderedItems = accompaniesArr;
      if (isStepKey) {
        if (busy) return;
        if (noshiRequired && !noshiChecked) {
          e.preventDefault();
          setNoshiChecked(true);
          return;
        }
        const next = orderedItems.find((a) => !checkedIds.has(a.id));
        if (next) {
          e.preventDefault();
          setCheckedIds((prev) => new Set(prev).add(next.id));
        }
        return;
      }
      if (isUnstepKey) {
        if (busy) return;
        // 直近☑された同梱物を1件オフ。なければのしをオフ
        for (let i = orderedItems.length - 1; i >= 0; i--) {
          if (checkedIds.has(orderedItems[i].id)) {
            e.preventDefault();
            setCheckedIds((prev) => {
              const next = new Set(prev);
              next.delete(orderedItems[i].id);
              return next;
            });
            return;
          }
        }
        if (noshiRequired && noshiChecked) {
          e.preventDefault();
          setNoshiChecked(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    open,
    busy,
    onBack,
    accompaniesArr,
    noshiRequired,
    noshiChecked,
    checkedIds,
  ]);

  if (!open) return null;

  // 商品サマリ
  const totalQty = items.reduce((s, it) => s + it.qty, 0);
  const doneQty = items.reduce(
    (s, it) => s + (it.forceOk ? it.qty : Math.min(it.scannedQty, it.qty)),
    0,
  );
  const forceN = items.filter((it) => it.forceOk).length;

  const isHandy = variant === 'handy';

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-2 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onBack();
      }}
    >
      <div
        className={`bg-surface-panel border border-surface-border rounded-2xl shadow-modal w-full max-h-[94vh] overflow-auto ${
          isHandy ? 'max-w-md' : 'max-w-2xl'
        }`}
      >
        {/* ヘッダ */}
        <div className="px-4 py-3 border-b border-surface-border bg-emerald-950/30">
          <h2 className="text-base font-bold text-status-ok">
            ✓ 最終チェック<span className="ml-2 text-2xs text-emerald-200 font-normal">（自動展開）</span>
          </h2>
          <p className="text-2xs text-ink-subtle mt-0.5 leading-snug">
            商品検品が完了しました。<b className="text-amber-300">のし</b>・
            <b className="text-pink-300">同梱物</b>を全て確認のうえ、
            <b className="text-cyan-300">「納品書をスキャン」</b> ボタンが有効になります。
          </p>
        </div>

        <div className="p-4 space-y-3">
          {/* 商品検品状況サマリ —
              モック準拠（ハンディ v0.11 で「画面狭く目視確認難」のため撤去済）。
              タブレットのみ表示する。 */}
          {!isHandy && (
          <div className="bg-surface-base border-l-4 border-status-ok rounded p-2.5">
            <div className="flex justify-between items-baseline mb-1.5">
              <div className="text-2xs text-status-ok tracking-wider">✓ 商品検品状況</div>
              <div className="text-2xs text-ink">
                <b className="text-status-ok tabular-nums">{doneQty}</b> / {totalQty} 点{' '}
                {doneQty >= totalQty && (
                  <span className="text-status-ok ml-1">(全件完了)</span>
                )}
              </div>
            </div>
            <div className="space-y-0.5">
              {items.map((it) => {
                const done = it.forceOk ? it.qty : Math.min(it.scannedQty, it.qty);
                const isComplete = done >= it.qty;
                return (
                  <div key={it.id} className="flex items-center gap-2 text-2xs">
                    <span
                      className={`w-4 font-bold ${isComplete ? 'text-status-ok' : 'text-status-warn'}`}
                    >
                      {isComplete ? '✓' : '◯'}
                    </span>
                    <span className="flex-1 text-ink truncate">{it.productName}</span>
                    {it.forceOk && (
                      <span className="text-3xs bg-amber-900 text-amber-100 px-1 rounded">
                        強制
                      </span>
                    )}
                    <span className="font-mono text-ink-subtle text-3xs tabular-nums">
                      {done}/{it.qty}
                    </span>
                  </div>
                );
              })}
            </div>
            {forceN > 0 && (
              <div className="mt-2 px-2 py-1 bg-amber-950/50 border border-amber-700 rounded text-3xs text-amber-100">
                ⚠ <b>{forceN}</b> 点が強制OK扱いです
              </div>
            )}
          </div>
          )}

          {/* のし確認行 — モック v0.16 準拠：白背景＋黒文字で視認性アップ */}
          {noshiRequired && (
            <button
              type="button"
              onClick={() => setNoshiChecked((v) => !v)}
              className={`w-full text-left rounded border-l-4 p-2.5 transition-colors ${
                noshiChecked
                  ? 'border-l-emerald-500 bg-emerald-50 hover:bg-emerald-100'
                  : 'border-l-amber-500 bg-white hover:bg-amber-50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-7 h-7 rounded flex items-center justify-center text-base font-bold border-2 ${
                    noshiChecked
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'bg-white border-amber-500 text-amber-600'
                  }`}
                >
                  {noshiChecked ? '✓' : ''}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-2xs text-amber-700 font-bold">🎁 のし</div>
                  <div className="text-sm font-bold text-slate-900 truncate">
                    名入れ：{noshiName}
                  </div>
                </div>
              </div>
            </button>
          )}

          {/* 同梱指示・同梱物リスト */}
          <div>
            <div className="text-2xs text-ink-subtle tracking-wider mb-1">
              同梱指示・同梱物（補助マスタ）
            </div>
            {accompanies === null ? (
              <div className="bg-surface-base rounded p-3 text-2xs text-ink-muted text-center">
                読み込み中…
              </div>
            ) : accompaniesArr.length === 0 ? (
              <div className="bg-surface-base rounded p-3 text-2xs text-ink-muted text-center">
                同梱物なし
              </div>
            ) : (
              <div className="bg-surface-base rounded p-1.5 max-h-[28vh] overflow-auto space-y-1">
                {accompaniesArr.map((a) => {
                  const checked = checkedIds.has(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() =>
                        setCheckedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(a.id)) next.delete(a.id);
                          else next.add(a.id);
                          return next;
                        })
                      }
                      className={`w-full text-left rounded p-2 flex items-center gap-2 border-l-4 transition-colors ${
                        checked
                          ? 'border-l-emerald-500 bg-emerald-50 hover:bg-emerald-100'
                          : 'border-l-sky-400 bg-white hover:bg-sky-50'
                      }`}
                    >
                      <div
                        className={`w-6 h-6 rounded flex items-center justify-center text-sm font-bold border-2 ${
                          checked
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'bg-white border-sky-400 text-sky-500'
                        }`}
                      >
                        {checked ? '✓' : ''}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-900 leading-tight truncate">
                          {a.name}
                        </div>
                        {a.packingNote && (
                          <div className="text-2xs text-slate-600 mt-0.5 truncate">
                            {a.packingNote}
                          </div>
                        )}
                      </div>
                      <div className="text-3xs text-slate-500 tracking-wide">{a.type}</div>
                    </button>
                  );
                })}
              </div>
            )}
            {packingNote && (
              <div className="mt-1.5 text-3xs text-ink-subtle bg-surface-base rounded p-2 border border-surface-border">
                📝 梱包メモ: {packingNote}
              </div>
            )}
          </div>

          {/* 進捗バー */}
          <div className="bg-surface-base rounded p-2 flex items-center gap-2 text-2xs">
            <span className="text-ink-subtle">確認状況</span>
            <div className="flex-1 h-1.5 bg-surface-panel rounded overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-status-ok to-emerald-300 transition-all"
                style={{
                  width:
                    totalChecks === 0
                      ? '100%'
                      : `${Math.round((checkedCount / totalChecks) * 100)}%`,
                }}
              />
            </div>
            <span className="text-ink tabular-nums">
              <b className={allChecked ? 'text-status-ok' : 'text-ink'}>
                {checkedCount}
              </b>{' '}
              / {totalChecks}
            </span>
          </div>

          {/* 納品書スキャン: 視覚的なプロンプト + テスト用に手入力できる枠を残す */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(invoiceInput);
              setInvoiceInput('');
            }}
            className={allChecked ? '' : 'opacity-60'}
          >
            <div
              className={cn(
                'rounded-lg p-3 transition-colors',
                allChecked
                  ? 'bg-cyan-950/40 border-2 border-cyan-500'
                  : 'bg-surface-base border-2 border-surface-border',
              )}
            >
              <div className="flex items-center gap-3 mb-2">
                <span style={{ fontSize: 24 }}>📷</span>
                <div className="flex-1">
                  <div
                    className={cn(
                      'text-sm font-bold',
                      allChecked ? 'text-cyan-200' : 'text-ink-muted',
                    )}
                  >
                    {allChecked
                      ? '納品書バーコードをスキャンしてください'
                      : 'のし・同梱物すべて☑ してください'}
                  </div>
                  <div className="text-3xs text-ink-muted mt-0.5">
                    外付スキャナで自動入力／本番運用ではスキャン Enter で即完了
                  </div>
                </div>
                {allChecked && (
                  <span
                    className="animate-pulse"
                    style={{
                      width: 10,
                      height: 10,
                      background: '#67e8f9',
                      borderRadius: '50%',
                    }}
                  />
                )}
              </div>
              {/* テスト用: 手入力できる枠（本番ではスキャナ専用） */}
              <input
                ref={invoiceInputRef}
                type="text"
                value={invoiceInput}
                onChange={(e) => {
                  setInvoiceInput(e.target.value);
                  if (invoiceError) setInvoiceError(null);
                }}
                disabled={!allChecked || busy}
                placeholder={
                  allChecked
                    ? 'スキャナで読取り（または手入力 → Enter）'
                    : '— 上記☑ で有効化 —'
                }
                autoComplete="off"
                className={cn(
                  'w-full rounded px-3 py-2 font-mono text-base text-ink-strong tabular-nums focus:outline-none transition-colors',
                  invoiceError
                    ? 'bg-status-error-bg border-2 border-status-error focus:border-status-error focus:ring-2 focus:ring-status-error/30'
                    : allChecked
                    ? 'bg-surface-base border-2 border-cyan-700 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-500/30'
                    : 'bg-surface-panel border-2 border-surface-border',
                )}
              />
              {invoiceError && (
                <div className="mt-2 flex items-start gap-2 text-2xs bg-status-error-bg border-2 border-status-error rounded p-2.5 text-status-error font-bold">
                  <span className="text-base leading-none">⚠</span>
                  <span className="flex-1 leading-snug">{invoiceError}</span>
                </div>
              )}
            </div>
          </form>

          {/* QR印刷フラグ表示（情報のみ） */}
          {qrPrintFlag && (
            <div className="text-2xs text-pink-200 bg-pink-950/30 border border-pink-700 rounded p-2">
              🖨 QR 印刷フラグ <b>ON</b> — 納品書スキャン後に自動印刷されます
            </div>
          )}
        </div>

        {/* フッタ */}
        <div className="px-4 py-3 border-t border-surface-border flex justify-end gap-2 sticky bottom-0 bg-surface-panel">
          <button
            onClick={onBack}
            disabled={busy}
            className="px-4 py-2 rounded border border-surface-border bg-surface-base text-ink text-sm disabled:opacity-50"
          >
            戻る
          </button>
          <button
            onClick={() => {
              if (allChecked) {
                invoiceInputRef.current?.focus();
              }
            }}
            disabled={!allChecked || busy}
            className={`px-4 py-2 rounded font-bold text-sm flex items-center gap-2 transition-all ${
              allChecked && !busy
                ? 'bg-cyan-700 text-white border border-cyan-400 animate-pulse-amber hover:bg-cyan-600'
                : 'bg-surface-base text-ink-muted border border-surface-border cursor-not-allowed'
            }`}
            title={
              allChecked
                ? '納品書バーコードをスキャンしてください'
                : 'のし・同梱物すべて☑ してください'
            }
          >
            <span>📷</span>
            {busy ? '完了中…' : '納品書をスキャン'}
          </button>
        </div>
      </div>
    </div>
  );
}
