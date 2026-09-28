'use client';

/**
 * 現場端末（タブレット・ハンディ）の進捗表示。
 *
 * 出典：要望書「LogiSmile現場向け進捗表示機能の追加」（久保様 2026-09-27）要望①②③
 *
 *   ① 待受け画面の最上部に常時表示バー（全体％・自分のテーブル％）
 *   ② タップで詳細（全体／テーブル別／自分の件数・作業ペース／配送業者別 残件）
 *   ③ 作業ペースのバッジ（現場の自己確認用。評価目的ではない）
 *
 * ★ タブレットとハンディで**同じ中身**を出す（要望書の指示）。違うのは寸法だけ。
 *   ハンディは画面が小さく現場の見やすさがタブレット以上に重要なため、
 *   文字を 30〜40% 大きく・コントラストを高くする（`variant='handy'`）。
 *
 * ★ 検品作業中の画面には出さない。**待受け（スキャン前）だけ**（要望書）。
 *
 * ★ 詳細は画面遷移ではなく**重ねて出す**。ハンディはスキャナのフォーカスが
 *   入力欄に戻らないと次が読めないため、閉じたときにフォーカスを戻す
 *   （既存のモーダルと同じ作法）。
 */

import { useCallback, useEffect, useState } from 'react';

export interface FieldCarrier {
  carrierCode: string;
  carrierName: string;
  short: string | null;
  remaining: number;
}

export interface FieldGroup {
  groupId: string;
  groupName: string;
  plan: number;
  done: number;
  remaining: number;
  rate: number;
  carriers: FieldCarrier[];
}

export interface FieldProgressData {
  date: string;
  overall: { total: number; done: number; remaining: number; rate: number };
  groups: FieldGroup[];
  me: {
    groupId: string | null;
    groupName: string | null;
    count: number;
    workedMin: number;
    perHour: number | null;
    badge: 'red' | 'yellow' | 'green' | null;
    badgeText: string | null;
    targetYellowMin: number | null;
    revisit: boolean;
  };
}

type Variant = 'tablet' | 'handy';

/** ハンディは文字を一回り大きく（要望書：タブレットより 30〜40% 大きく）。 */
const SIZE = {
  tablet: {
    label: 'text-[11px]',
    pct: 'text-[14px]',
    num: 'text-[12px]',
    head: 'text-[12px]',
    big: 'text-[22px]',
  },
  handy: {
    label: 'text-[13px]',
    pct: 'text-[19px]',
    num: 'text-[16px]',
    head: 'text-[15px]',
    big: 'text-[28px]',
  },
} as const;

const BADGE_CLASS: Record<string, string> = {
  red: 'bg-red-500 text-white',
  yellow: 'bg-amber-400 text-amber-950',
  green: 'bg-emerald-500 text-white',
};

/** 待受け画面に置く常時表示バー。タップで詳細が開く。 */
export function FieldProgressBar({ variant }: { variant: Variant }) {
  const [data, setData] = useState<FieldProgressData | null>(null);
  const [open, setOpen] = useState(false);
  const s = SIZE[variant];

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/field/progress');
      if (!r.ok) return;
      const j = await r.json();
      if (j?.data) setData(j.data as FieldProgressData);
    } catch {
      // 端末は電波が切れることがある。黙って次の周期を待つ（画面は前回値のまま）
    }
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 15_000);
    return () => clearInterval(id);
  }, [reload]);

  // 詳細を閉じたらスキャン入力へフォーカスを戻す（ハンディのスキャナ対策）
  useEffect(() => {
    if (open) return;
    const el = document.querySelector<HTMLInputElement>('input[placeholder="SA01208680006"]');
    el?.focus();
  }, [open]);

  if (!data) {
    return (
      <div className="rounded-xl border border-surface-border bg-surface-panel px-3 py-2.5">
        <span className={`${s.label} text-ink-muted`}>本日の進捗を読み込み中…</span>
      </div>
    );
  }

  const mine = data.me.groupId ? data.groups.find((g) => g.groupId === data.me.groupId) : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-surface-border bg-surface-panel px-3 py-2.5 text-left active:bg-surface-raised"
      >
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className={`${s.head} font-bold text-ink-strong`}>本日の進捗</span>
          <span className={`${s.label} text-sky-400`}>テーブル×業者の詳細 ›</span>
        </div>
        <div className="flex gap-3">
          <MiniBar
            variant={variant}
            label="全体"
            rate={data.overall.rate}
            done={data.overall.done}
            total={data.overall.total}
            tone="amber"
          />
          <MiniBar
            variant={variant}
            label={mine ? `自分（${mine.groupName}）` : '自分のテーブル'}
            rate={mine?.rate ?? 0}
            done={mine?.done ?? 0}
            total={mine?.plan ?? 0}
            tone="sky"
            muted={!mine}
          />
        </div>
      </button>

      {open && <FieldProgressDetail data={data} variant={variant} onClose={() => setOpen(false)} />}
    </>
  );
}

function MiniBar({
  variant,
  label,
  rate,
  done,
  total,
  tone,
  muted,
}: {
  variant: Variant;
  label: string;
  rate: number;
  done: number;
  total: number;
  tone: 'amber' | 'sky';
  muted?: boolean;
}) {
  const s = SIZE[variant];
  const barColor = tone === 'amber' ? 'bg-accent-amber' : 'bg-sky-400';
  const pctColor = tone === 'amber' ? 'text-accent-amber' : 'text-sky-400';
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-1.5">
        <span className={`${s.label} truncate text-ink-subtle`}>{label}</span>
        <span className={`${s.pct} font-bold tabular-nums ${muted ? 'text-ink-muted' : pctColor}`}>
          {muted ? '—' : `${rate}%`}
        </span>
      </div>
      <div className={`${s.num} tabular-nums text-ink`}>
        {muted ? (
          <span className="text-ink-muted">まだスキャンがありません</span>
        ) : (
          <>
            {done.toLocaleString()}
            <span className="text-ink-muted"> /{total.toLocaleString()}</span>
          </>
        )}
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-surface-base">
        <div className={`h-full ${barColor}`} style={{ width: `${muted ? 0 : rate}%` }} />
      </div>
    </div>
  );
}

/** タップで開く詳細。①全体 ②テーブル別 ③自分の件数・ペース。 */
function FieldProgressDetail({
  data,
  variant,
  onClose,
}: {
  data: FieldProgressData;
  variant: Variant;
  onClose: () => void;
}) {
  const s = SIZE[variant];
  const { me } = data;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface-base p-3">
      <div className="mx-auto max-w-2xl space-y-3 pb-24">
        <div className="flex items-center justify-between">
          <h2 className={`${s.big} font-bold text-ink-strong`}>本日の進捗</h2>
          <span className={`${s.label} tabular-nums text-ink-muted`}>{data.date}</span>
        </div>

        {/* ① 全体進捗 */}
        <section className="rounded-xl border border-surface-border bg-surface-panel p-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className={`${s.head} font-bold text-ink-strong`}>全体進捗</span>
            <span className={`${s.big} font-bold tabular-nums text-accent-amber`}>
              {data.overall.rate}%
            </span>
          </div>
          <div className={`${s.num} tabular-nums text-ink`}>
            {data.overall.done.toLocaleString()}
            <span className="text-ink-muted"> / {data.overall.total.toLocaleString()} 件</span>
            <span className="ml-2 text-ink-subtle">
              残 {data.overall.remaining.toLocaleString()} 件
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded bg-surface-base">
            <div className="h-full bg-accent-amber" style={{ width: `${data.overall.rate}%` }} />
          </div>
        </section>

        {/* ③ 自分の件数・作業ペース */}
        <section className="rounded-xl border border-surface-border bg-surface-panel p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className={`${s.head} font-bold text-ink-strong`}>個人進捗（本日）</span>
            {me.groupName && (
              <span className={`${s.label} rounded-full bg-sky-950 px-2 py-0.5 text-sky-300`}>
                {me.groupName}
              </span>
            )}
          </div>
          <div className="flex gap-4">
            <div className="min-w-0 flex-1">
              <div className={`${s.label} text-ink-subtle`}>① 本日の処理件数</div>
              <div className={`${s.big} font-bold tabular-nums text-sky-300`}>
                {me.count.toLocaleString()} <span className={`${s.num} font-normal`}>件</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className={`${s.label} text-ink-subtle`}>② 作業ペース</div>
              {me.perHour == null ? (
                <>
                  <div className={`${s.big} font-bold tabular-nums text-ink-muted`}>—</div>
                  <div className={`${s.label} text-ink-muted`}>
                    {me.revisit
                      ? '同じテーブルを行き来した日のため集計対象外です'
                      : 'メンバー割当が未登録のため出せません'}
                  </div>
                </>
              ) : (
                <>
                  <div className={`${s.big} font-bold tabular-nums text-ink-strong`}>
                    {me.perHour} <span className={`${s.num} font-normal`}>件/時</span>
                  </div>
                  {me.targetYellowMin != null && (
                    <div className={`${s.label} text-ink-muted`}>目標 {me.targetYellowMin}件/時</div>
                  )}
                  {me.badge && me.badgeText && (
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 ${s.label} font-bold ${
                        BADGE_CLASS[me.badge] ?? ''
                      }`}
                    >
                      {me.badgeText}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <p className={`mt-2 ${s.label} text-ink-muted`}>
            ペースは自分の作業を振り返るための目安です（実働時間はメンバー割当の配置時間）。
          </p>
        </section>

        {/* ② テーブル別 × 配送業者別 残件数 */}
        <div>
          <h3 className={`mb-1.5 ${s.head} font-bold text-ink-strong`}>
            テーブル別 × 配送業者別 残件数
          </h3>
          <div className="space-y-2">
            {data.groups.map((g) => {
              const isMine = g.groupId === me.groupId;
              return (
                <section
                  key={g.groupId}
                  className={`rounded-xl border p-3 ${
                    isMine
                      ? 'border-sky-600/60 bg-sky-950/40'
                      : 'border-surface-border bg-surface-panel'
                  }`}
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span
                      className={`${s.head} font-bold ${isMine ? 'text-sky-300' : 'text-ink-subtle'}`}
                    >
                      {g.groupName}
                      {isMine && <span className={`${s.label} ml-1`}>（自分のテーブル）</span>}
                    </span>
                    <span className={`${s.num} shrink-0 tabular-nums text-ink`}>
                      {g.done.toLocaleString()}
                      <span className="text-ink-muted"> / {g.plan.toLocaleString()}</span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-surface-base">
                    <div
                      className={`h-full ${isMine ? 'bg-sky-400' : 'bg-ink-muted'}`}
                      style={{ width: `${g.rate}%` }}
                    />
                  </div>
                  {g.carriers.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {g.carriers.map((c) => (
                        <div
                          key={c.carrierCode}
                          className="rounded-lg bg-surface-base px-2 py-1 text-center"
                        >
                          <div className={`${s.label} text-ink-subtle`}>
                            {c.short ?? c.carrierName}
                          </div>
                          <div className={`${s.pct} font-bold tabular-nums text-accent-amber`}>
                            {c.remaining}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`mt-2 ${s.label} text-ink-muted`}>
                      {g.plan > 0 ? '残りはありません' : '本日の割当はありません'}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>

      {/* 閉じるは常に指の届く位置に固定（ハンディは片手操作） */}
      <div className="fixed inset-x-0 bottom-0 border-t border-surface-border bg-surface-base p-3">
        <button
          type="button"
          onClick={onClose}
          className={`w-full rounded-xl bg-accent-amber py-3 ${s.head} font-bold text-black`}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
