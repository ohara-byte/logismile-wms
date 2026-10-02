'use client';

/**
 * 🚚 運送会社別 タブ
 *
 * モック準拠（管理用PCモック_v0.22.html L2700-2789 + .carr-* スタイル）
 *
 * 仕様:
 *  - GET /api/carriers/today で運送会社別の当日進捗を取得（5 秒ポーリング）
 *  - 各社カード:
 *      アイコン（短縮名 + 色） / 名称 / 出荷件数 / 完了 / 残件 /
 *      進捗バー / 集荷時刻カウントダウン / アラートレベル枠
 *  - 残件リスト印刷 / 送り状 CSV ボタン（CSV は A-07-CSV、印刷は将来）
 */

import { useCallback, useEffect, useState } from 'react';

interface CarrierStat {
  carrier: {
    code: string;
    name: string;
    short: string | null;
    cool: boolean;
    pickup: string | null;
    cutoff: string | null;
    priority: number;
  };
  total: number;
  completed: number;
  remaining: number;
  progressRate: number; // 0..1
  minutesUntilPickup: number | null;
  alertLevel: 'normal' | 'warn' | 'alert';
}

interface ApiResp {
  date: string;
  totalShipments: number;
  items: CarrierStat[];
}

export function CarrPane() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ★ 要望書 2026-09-27 要望④：テーブルグループ×配送業者の残件マトリクス。
  //   既存のカードは一切変えず、ヘッダー行にリンクを1つ足して別画面で出す。
  const [matrixOpen, setMatrixOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/carriers/today');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j.data);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [reload]);

  if (!data) {
    return (
      <div className="p-3 text-2xs text-ink-muted flex items-center gap-2">
        <span className="w-1.5 h-1.5 bg-accent-amber rounded-full animate-pulse" />
        読み込み中…
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-2xs text-ink-subtle">
          本日出荷{' '}
          <b className="text-accent-amber tabular-nums">
            {data.totalShipments.toLocaleString()}
          </b>
          件 ／ 運送会社別 残件数と集荷時刻
        </div>
        <div className="flex-1" />
        {/* ★ 要望書 要望④：集荷が迫ったとき「どのテーブルに何件残っているか」を
            PC画面ひとつで見るための入口。カード側は現行のまま。 */}
        <button
          type="button"
          onClick={() => setMatrixOpen(true)}
          className="shrink-0 px-3 py-1.5 text-2xs rounded bg-sky-700 text-white hover:bg-sky-600"
        >
          📍 テーブルごとの残り件数を見る ›
        </button>
      </div>

      {matrixOpen && <TableCarrierMatrix onClose={() => setMatrixOpen(false)} />}

      {error && (
        <div className="mb-2 p-2 text-2xs bg-status-error-bg text-status-error border border-status-error rounded">
          {error}
        </div>
      )}

      {data.items.length === 0 ? (
        <div className="text-center py-6 text-2xs text-ink-muted">
          運送会社マスタが未登録です
        </div>
      ) : (
        data.items.map((it) => <CarrierCard key={it.carrier.code} stat={it} />)
      )}

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => alert('運送会社別 残件リストを印刷します（実装は将来ブロック）')}
          className="flex-1 px-3 py-1.5 text-xs rounded border border-surface-border bg-surface-base text-ink hover:bg-surface-raised hover:border-accent-amber"
        >
          🖨 残件リスト印刷
        </button>
        <button
          onClick={() => alert('送り状システム向け CSV を出力します（A-07-CSV で実装予定）')}
          className="flex-1 px-3 py-1.5 text-xs rounded border border-surface-border bg-surface-base text-ink hover:bg-surface-raised hover:border-accent-amber"
        >
          ⬇ 送り状 CSV
        </button>
      </div>
    </div>
  );
}

function CarrierCard({ stat }: { stat: CarrierStat }) {
  const c = stat.carrier;
  const { color, icon } = carrierVisual(c);
  const progressPct = Math.round(stat.progressRate * 100);

  // 枠の色（alertLevel ベース）
  const borderClass =
    stat.alertLevel === 'alert'
      ? 'border-status-error'
      : stat.alertLevel === 'warn'
        ? 'border-status-warn'
        : 'border-surface-border';

  // バーの色（基本は青〜緑グラデ、alert/warn は単色）
  const barFillClass =
    stat.alertLevel === 'alert'
      ? 'bg-status-error'
      : stat.alertLevel === 'warn'
        ? 'bg-status-warn'
        : 'bg-gradient-to-r from-emerald-600 to-blue-500';

  return (
    <div
      className={`grid gap-2 mb-1.5 px-2 py-1.5 rounded border bg-surface-base ${borderClass}`}
      style={{ gridTemplateColumns: '36px 1fr 100px' }}
    >
      {/* アイコン */}
      <div
        className="rounded flex items-center justify-center text-white text-xs font-bold leading-none self-start"
        style={{ width: 36, height: 36, background: color }}
      >
        {icon}
      </div>

      {/* 中央: 名称 + 件数 + 進捗バー */}
      <div className="min-w-0">
        <div className="text-xs font-bold text-ink-strong truncate">
          {c.name}
          {c.cool && <span className="ml-1 text-status-info">❄</span>}
        </div>
        <div className="text-[10px] text-ink-subtle tabular-nums">
          出荷 <b className="text-ink">{stat.total.toLocaleString()}</b>件 ／ 完了{' '}
          <b className="text-status-ok">{stat.completed.toLocaleString()}</b> ／ 残{' '}
          <b className={stat.remaining > 100 ? 'text-status-error' : 'text-ink'}>
            {stat.remaining.toLocaleString()}
          </b>
        </div>
        <div className="mt-1 h-1.5 bg-surface-panel rounded overflow-hidden">
          <div
            className={`h-full ${barFillClass} transition-all`}
            style={{ width: `${Math.min(progressPct, 100)}%` }}
          />
        </div>
      </div>

      {/* 右: % + 集荷時刻 */}
      <div className="text-right">
        <div className="text-base font-bold text-ink-strong leading-none tabular-nums">
          {progressPct}
          <small className="text-2xs text-ink-muted ml-0.5">%</small>
        </div>
        <PickupCountdown stat={stat} />
        {c.pickup && (
          <div
            className={`mt-1 text-[10px] inline-block px-1 rounded ${
              stat.alertLevel === 'alert'
                ? 'bg-red-900 text-red-100 font-bold'
                : 'bg-surface-panel text-ink-muted'
            }`}
          >
            集荷 {c.pickup}
            {stat.alertLevel === 'alert' && ' ⚠'}
          </div>
        )}
      </div>
    </div>
  );
}

function PickupCountdown({ stat }: { stat: CarrierStat }) {
  if (stat.minutesUntilPickup === null) {
    return <div className="text-[10px] text-ink-muted">集荷時刻 未設定</div>;
  }
  if (stat.minutesUntilPickup < 0) {
    return <div className="text-[10px] text-ink-muted">集荷時刻を過ぎました</div>;
  }
  const h = Math.floor(stat.minutesUntilPickup / 60);
  const m = stat.minutesUntilPickup % 60;
  const remaining = `${pad(h)}:${pad(m)}`;
  const cls =
    stat.alertLevel === 'alert'
      ? 'text-status-error font-bold'
      : stat.alertLevel === 'warn'
        ? 'text-status-warn'
        : 'text-status-ok';
  return (
    <div className={`text-[10px] tabular-nums ${cls}`}>
      集荷まで {remaining}（{stat.carrier.pickup}）
    </div>
  );
}

/** 運送会社の見た目（アイコン文字 + 色）。short / code から推定 */
function carrierVisual(c: CarrierStat['carrier']): { icon: string; color: string } {
  const short = c.short ?? '';
  const code = c.code.toUpperCase();
  // 既知の運送会社（モック L2706-2780 のパレット準拠）
  if (code.includes('YAMATO') || short.startsWith('ヤマト')) {
    if (c.cool) return { icon: 'ク', color: '#0891b2' };
    return { icon: '宅', color: '#16a34a' };
  }
  if (code.includes('SAGAWA') || short.startsWith('佐')) {
    return { icon: '佐', color: '#dc2626' };
  }
  if (code.includes('YUPACK') || code.includes('JP') || short.startsWith('ゆう')) {
    if (c.cool) return { icon: '郵ク', color: '#7c3aed' };
    return { icon: '郵', color: '#be123c' };
  }
  return { icon: short ? short.slice(0, 2) : '他', color: '#64748b' };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * テーブルグループ × 配送業者 の残件数マトリクス（要望書 2026-09-27 要望④）。
 *
 * ★ 新規のトップレベルタブにはしない。運送タブ内の別画面として重ねる。
 * ★ 伝票単位の一覧は出さない（未検品伝票の確認は伝票一覧で足りる）。
 * ★ 最下段の合計は運送タブのカードと一致する（同じ「残件」の定義を使うため）。
 */
interface MatrixResp {
  date: string;
  carriers: { code: string; name: string; short: string | null; cool: boolean }[];
  rows: { groupId: string; groupName: string; total: number; byCarrier: Record<string, number> }[];
  total: { total: number; byCarrier: Record<string, number> };
}

function TableCarrierMatrix({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<MatrixResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/carriers/table-matrix');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j.data);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    reload();
    // 集荷が迫った局面で見る画面なので、運送タブと同じ 5 秒で追従させる
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [reload]);

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-surface-base/95 p-4">
      <div className="mx-auto max-w-5xl">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-[16px] font-bold text-ink-strong">
            📍 テーブルグループ × 配送業者 残件数
          </h2>
          {data && <span className="text-[14px] tabular-nums text-ink-subtle">{data.date}</span>}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-surface-border bg-surface-panel px-3 py-1.5 text-[16px] text-ink hover:bg-surface-raised"
          >
            閉じる
          </button>
        </div>

        {error && (
          <div className="mb-2 rounded border border-status-error bg-status-error-bg p-2 text-[14px] text-status-error">
            {error}
          </div>
        )}

        {!data ? (
          <div className="py-8 text-center text-[16px] text-ink-subtle">読み込み中…</div>
        ) : (
          <div className="overflow-x-auto rounded border border-surface-border">
            <table className="w-full text-[16px]">
              <thead className="border-b border-surface-border bg-surface-base">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[16px] font-semibold text-ink-subtle">
                    テーブルグループ
                  </th>
                  <th className="px-2 py-1.5 text-right text-[16px] font-semibold text-ink-subtle">
                    残計
                  </th>
                  {data.carriers.map((c) => (
                    <th
                      key={c.code}
                      className="px-2 py-1.5 text-right text-[16px] font-semibold text-ink-subtle whitespace-nowrap"
                    >
                      {c.short ?? c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.groupId} className="border-t border-surface-border">
                    <td className="px-2 py-1 font-bold text-ink-strong">{r.groupName}</td>
                    <td
                      className={`px-2 py-1 text-right font-bold tabular-nums ${
                        r.total > 0 ? 'text-accent-amber' : 'text-ink-muted'
                      }`}
                    >
                      {r.total || '–'}
                    </td>
                    {data.carriers.map((c) => {
                      const v = r.byCarrier[c.code] ?? 0;
                      return (
                        <td
                          key={c.code}
                          className={`px-2 py-1 text-right tabular-nums ${
                            v > 0 ? 'text-ink' : 'text-ink-muted'
                          }`}
                        >
                          {v || '–'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t-2 border-surface-border bg-surface-panel">
                  <td className="px-2 py-1.5 font-bold text-ink-strong">全体 合計</td>
                  <td className="px-2 py-1.5 text-right font-bold tabular-nums text-accent-amber">
                    {data.total.total}
                  </td>
                  {data.carriers.map((c) => {
                    const v = data.total.byCarrier[c.code] ?? 0;
                    return (
                      <td
                        key={c.code}
                        className={`px-2 py-1.5 text-right font-bold tabular-nums ${
                          v > 0 ? 'text-accent-amber' : 'text-ink-muted'
                        }`}
                      >
                        {v || 0}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-2 text-[14px] text-ink-subtle">
          残件＝まだ梱包が終わっていない伝票。合計は運送タブのカードと一致します。
          伝票ごとの内訳は伝票一覧でご確認ください。
        </p>
      </div>
    </div>
  );
}
