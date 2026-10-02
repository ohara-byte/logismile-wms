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

/**
 * 文字サイズ。
 *
 * ★ 2026-10-02 改訂（要望書「進捗表示の視認性改善」久保様）。
 *   実機で「ラベル・件数が小さく薄くて読みづらい」との報告があり、実測値をもとに
 *   **待受けカード**と**詳細画面**で別々に引き上げた。要望書の数値はタブレット基準。
 *
 *   ハンディはタブレットより一回り大きい関係を保つ（画面が小さく、離れて見るため）。
 *   引き上げ後もハンディ ≧ タブレットになるよう、従来と同じ差分（+2〜+6px）を維持する。
 *
 *   大きい数値（big）と業者別残件数（carrierNum）は要望書どおり**現状維持**。
 */

/** 待受けカード（要望書 ①）。 */
const CARD = {
  tablet: {
    head: 'text-[15px]', // 「本日の進捗」見出し（12px → 15px）
    link: 'text-[13px]', // 「テーブル×業者の詳細 ›」（11px → 13px・ボタン化）
    label: 'text-[14px]', // 「全体」「自分（…）」（11px → 14px）
    pct: 'text-[17px]', // ％（14px → 17px）
    num: 'text-[17px]', // 件数（12px → 17px）
    denom: 'text-[14px]', // 分母 /1,116（12px → 14px）
  },
  handy: {
    head: 'text-[18px]',
    link: 'text-[15px]',
    label: 'text-[16px]',
    pct: 'text-[20px]',
    num: 'text-[20px]',
    denom: 'text-[16px]',
  },
} as const;

/** 詳細画面（要望書 ②）。11px/12px をまとめて 14px に。 */
const DETAIL = {
  tablet: {
    label: 'text-[14px]', // ラベル・注記（11px → 14px）
    num: 'text-[14px]', // 件数行（12px → 14px）
    head: 'text-[14px]', // 各セクション見出し（12px → 14px）
    big: 'text-[22px]', // 100% / 12件 / 1.5件/時 … 現状維持
    carrierNum: 'text-[14px]', // 業者別残件数の数値 … 現状維持
  },
  handy: {
    label: 'text-[16px]',
    num: 'text-[16px]',
    head: 'text-[17px]',
    big: 'text-[28px]',
    carrierNum: 'text-[16px]',
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
  const s = CARD[variant];

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
        <span className={`${s.label} text-ink-subtle`}>本日の進捗を読み込み中…</span>
      </div>
    );
  }

  const mine = data.me.groupId ? data.groups.find((g) => g.groupId === data.me.groupId) : undefined;

  return (
    <>
      {/* ★ 2026-10-02（要望書 ①変更点2）：押せることに気づかれなかったため、
          枠線を強め・右端に矢印・リンクをボタン状にして「押せる場所」を明示する。 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="本日の進捗の詳細を開く"
        className="flex w-full items-center gap-3 rounded-xl border-2 border-sky-700/70 bg-surface-panel px-3 py-3 text-left active:bg-surface-raised"
      >
        <span className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className={`${s.head} font-bold text-ink-strong`}>本日の進捗</span>
          <span
            className={`shrink-0 rounded-full border border-sky-600 bg-sky-950 px-2.5 py-1 ${s.link} font-bold text-sky-300`}
          >
            テーブル×業者の詳細 ›
          </span>
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
        </span>
        {/* 右端の矢印：カード全体がタップできることを示す */}
        <span aria-hidden="true" className="shrink-0 text-[28px] leading-none text-sky-400">
          ›
        </span>
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
  const s = CARD[variant];
  const barColor = tone === 'amber' ? 'bg-accent-amber' : 'bg-sky-400';
  const pctColor = tone === 'amber' ? 'text-accent-amber' : 'text-sky-400';
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-1.5">
        <span className={`${s.label} truncate font-semibold text-ink-soft`}>{label}</span>
        <span className={`${s.pct} font-bold tabular-nums ${muted ? 'text-ink-subtle' : pctColor}`}>
          {muted ? '—' : `${rate}%`}
        </span>
      </div>
      <div className={`${s.num} font-bold tabular-nums text-ink`}>
        {muted ? (
          <span className={`${s.denom} font-normal text-ink-subtle`}>まだスキャンがありません</span>
        ) : (
          <>
            {done.toLocaleString()}
            {/* 分母は本数字より一段小さく・一段暗く。ただし読める明るさにする */}
            <span className={`${s.denom} font-normal text-ink-subtle`}>
              {' '}
              /{total.toLocaleString()}
            </span>
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
  const s = DETAIL[variant];
  const { me } = data;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface-base p-3">
      <div className="mx-auto max-w-2xl space-y-3 pb-24">
        <div className="flex items-center justify-between">
          <h2 className={`${s.big} font-bold text-ink-strong`}>本日の進捗</h2>
          <span className={`${s.label} tabular-nums text-ink-subtle`}>{data.date}</span>
        </div>

        {/* ① 全体進捗 */}
        <section className="rounded-xl border border-surface-border bg-surface-panel p-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className={`${s.head} font-bold text-ink-strong`}>全体進捗</span>
            <span className={`${s.big} font-bold tabular-nums text-accent-amber`}>
              {data.overall.rate}%
            </span>
          </div>
          <div className={`${s.num} font-semibold tabular-nums text-ink`}>
            {data.overall.done.toLocaleString()}
            <span className="font-normal text-ink-soft"> / {data.overall.total.toLocaleString()} 件</span>
            <span className="ml-2 font-normal text-ink-soft">
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
              <span className={`${s.label} rounded-full bg-sky-950 px-2 py-0.5 font-bold text-sky-300`}>
                {me.groupName}
              </span>
            )}
          </div>
          <div className="flex gap-4">
            <div className="min-w-0 flex-1">
              <div className={`${s.label} font-semibold text-ink-soft`}>① 本日の処理件数</div>
              <div className={`${s.big} font-bold tabular-nums text-sky-300`}>
                {me.count.toLocaleString()} <span className={`${s.num} font-normal`}>件</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className={`${s.label} font-semibold text-ink-soft`}>② 作業ペース</div>
              {me.perHour == null ? (
                <>
                  <div className={`${s.big} font-bold tabular-nums text-ink-subtle`}>—</div>
                  <div className={`${s.label} text-ink-subtle`}>
                    {me.revisit
                      ? '同じテーブルを行き来した日のため集計対象外です'
                      : 'メンバー割当が未登録のため出せません'}
                  </div>
                </>
              ) : (
                <>
                  {/* ★ 2026-10-02（要望書 ②変更点2）：「目標」が数値の下に小さく出て
                      埋もれていたため、数値の**真横**にバッジとして並べる。 */}
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className={`${s.big} font-bold tabular-nums text-ink-strong`}>
                      {me.perHour} <span className={`${s.num} font-normal`}>件/時</span>
                    </span>
                    {me.targetYellowMin != null && (
                      <span
                        className={`shrink-0 rounded-full border border-surface-border-strong bg-surface-base px-2 py-0.5 ${s.label} font-semibold text-ink-soft`}
                      >
                        目標 {me.targetYellowMin}件/時
                      </span>
                    )}
                  </div>
                  {me.badge && me.badgeText && (
                    <span
                      className={`mt-1.5 inline-block rounded-full px-2.5 py-1 ${s.label} font-bold ${
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
          <p className={`mt-2 ${s.label} text-ink-subtle`}>
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
                      className={`${s.head} font-bold ${isMine ? 'text-sky-300' : 'text-ink'}`}
                    >
                      {g.groupName}
                      {isMine && <span className={`${s.label} ml-1`}>（自分のテーブル）</span>}
                    </span>
                    <span className={`${s.num} shrink-0 font-semibold tabular-nums text-ink`}>
                      {g.done.toLocaleString()}
                      <span className="font-normal text-ink-soft"> / {g.plan.toLocaleString()}</span>
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
                          <div className={`${s.label} font-semibold text-ink-soft`}>
                            {c.short ?? c.carrierName}
                          </div>
                          <div className={`${s.carrierNum} font-bold tabular-nums text-accent-amber`}>
                            {c.remaining}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`mt-2 ${s.label} text-ink-subtle`}>
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
