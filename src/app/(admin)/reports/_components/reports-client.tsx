'use client';

import { useEffect, useState } from 'react';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { TextInput } from '@/components/ui/form-controls';
import { StatCard } from '@/components/ui/stat-card';
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

const todayIso = () => new Date().toISOString().slice(0, 10);
function addDays(iso: string, d: number) {
  const x = new Date(iso);
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
}

const TABS = [
  { id: 'summary', label: 'サマリー' },
  { id: 'staff-mh', label: '担当者別MH' },
  { id: 'group-mh', label: 'グループMH' },
  { id: 'product-abc', label: '商品ABC' },
  { id: 'heatmap', label: 'ヒートマップ' },
  { id: 'insp-timeline', label: '検品タイムライン' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** 検品タイムラインの期間基準（小原様 2026-09-17「画面で選べるように」）。 */
const BASES = [
  { id: 'ship', label: '出荷日' },
  { id: 'start', label: '検品着手日' },
] as const;

type Basis = (typeof BASES)[number]['id'];

export function ReportsClient() {
  const [from, setFrom] = useState(addDays(todayIso(), -30));
  const [to, setTo] = useState(todayIso());
  const [tab, setTab] = useState<TabId>('summary');
  const [basis, setBasis] = useState<Basis>('ship');

  return (
    <div className="space-y-3">
      <Panel>
        <div className="p-3 flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-3xs text-ink-subtle uppercase tracking-wider block mb-1">
              期間 From
            </label>
            <TextInput
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="!w-auto"
            />
          </div>
          <div>
            <label className="text-3xs text-ink-subtle uppercase tracking-wider block mb-1">
              To
            </label>
            <TextInput
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="!w-auto"
            />
          </div>
          {tab === 'insp-timeline' && (
            <div>
              <label className="text-3xs text-ink-subtle uppercase tracking-wider block mb-1">
                期間の基準
              </label>
              <select
                value={basis}
                onChange={(e) => setBasis(e.target.value as Basis)}
                className="px-2 py-1.5 border border-surface-border-strong rounded text-xs bg-surface-base text-ink"
              >
                {BASES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex-1" />
          {tab === 'insp-timeline' ? (
            <a
              href={`/api/report/insp-timeline/export?from=${from}&to=${to}&basis=${basis}`}
              className="px-3 py-1.5 border border-surface-border-strong rounded text-xs bg-surface-base text-ink hover:bg-surface-raised"
            >
              📥 CSV出力
            </a>
          ) : (
            tab !== 'heatmap' && (
              <a
                href={`/api/report/export?type=${tab}&from=${from}&to=${to}`}
                className="px-3 py-1.5 border border-surface-border-strong rounded text-xs bg-surface-base text-ink hover:bg-surface-raised"
              >
                📥 CSV出力
              </a>
            )
          )}
        </div>
      </Panel>

      {/* タブ */}
      <div className="border-b border-surface-border flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-3 py-2 text-sm font-bold border-b-2 transition-colors',
              tab === t.id
                ? 'border-accent-amber text-accent-amber'
                : 'border-transparent text-ink-subtle hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'summary' && <SummaryTab from={from} to={to} />}
        {tab === 'staff-mh' && <StaffMhTab from={from} to={to} />}
        {tab === 'group-mh' && <GroupMhTab from={from} to={to} />}
        {tab === 'product-abc' && <ProductAbcTab from={from} to={to} />}
        {tab === 'heatmap' && <HeatmapTab from={from} to={to} />}
        {tab === 'insp-timeline' && <InspTimelineTab from={from} to={to} basis={basis} />}
      </div>
    </div>
  );
}

function useReport<T>(url: string): { data: T | null; busy: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true);
    fetch(url)
      .then((r) => r.json())
      .then((j) => setData(j.data ?? null))
      .finally(() => setBusy(false));
  }, [url]);
  return { data, busy };
}

interface SummaryData {
  from: string;
  to: string;
  totalShipped: number;
  totalPacked: number;
  completedCount: number;
  forceOkCount: number;
  avgPackingSec: number | null;
  totalMhHours: number;
}

function SummaryTab({ from, to }: { from: string; to: string }) {
  const { data, busy } = useReport<SummaryData>(`/api/report/summary?from=${from}&to=${to}`);
  if (busy || !data) return <Loading />;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
      <StatCard label="出荷件数" value={data.totalShipped} />
      <StatCard label="梱包完了" value={data.totalPacked} tone="ok" />
      <StatCard label="完了セッション" value={data.completedCount} />
      <StatCard label="強制OK" value={data.forceOkCount} tone="warn" />
      <StatCard label="平均梱包秒" value={data.avgPackingSec ?? '—'} />
      <StatCard label="総MH(h)" value={data.totalMhHours} tone="amber" />
    </div>
  );
}

interface StaffRow {
  staffCode: string;
  staffName: string;
  count: number;
  durationSec: number;
  mhHours: number;
  /** MHT：テーブル配置時間（人時）。2026-09-17 追加 */
  mhtHours: number;
  perMh: number | null;
  perMht: number | null;
  avgSec: number;
}
function StaffMhTab({ from, to }: { from: string; to: string }) {
  const { data, busy } = useReport<{ items: StaffRow[] }>(
    `/api/report/staff-mh?from=${from}&to=${to}`,
  );
  if (busy || !data) return <Loading />;
  return (
    <Table>
      <THead>
        <TH>担当者</TH>
        <TH align="right">件数</TH>
        <TH align="right">作業時間(秒)</TH>
        <TH align="right">MH(h)</TH>
        <TH align="right">件/MH</TH>
        <TH align="right">MHT(h)</TH>
        <TH align="right">件/MHT</TH>
        <TH align="right">平均秒/件</TH>
      </THead>
      <TBody>
        {data.items.length === 0 && <EmptyRow colSpan={8} />}
        {data.items.map((r) => (
          <TR key={r.staffCode}>
            <TD className="text-ink-strong font-bold">{r.staffName}</TD>
            <TD align="right" mono>
              {r.count}
            </TD>
            <TD align="right" mono className="text-ink-subtle">
              {r.durationSec.toLocaleString()}
            </TD>
            <TD align="right" mono className="text-accent-amber font-bold">
              {r.mhHours}
            </TD>
            <TD align="right" mono className="text-ink-subtle">
              {r.perMh == null ? '—' : r.perMh}
            </TD>
            <TD align="right" mono className="text-ink font-bold">
              {r.mhtHours}
            </TD>
            <TD align="right" mono className="text-ink-subtle">
              {r.perMht == null ? '—' : r.perMht}
            </TD>
            <TD align="right" mono>
              {r.avgSec}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

interface GroupRow {
  groupId: string;
  groupName: string;
  hourly: { hour: number; count: number; mhHours: number }[];
  totalCount: number;
  totalMhHours: number;
  /** MHT：そのグループへの配置時間（人時）。2026-09-17 追加 */
  mhtHours: number;
  /** 配置時間帯に完了した件数（件/MHT の分子） */
  mhtCount: number;
  perMht: number | null;
}
function GroupMhTab({ from, to }: { from: string; to: string }) {
  const { data, busy } = useReport<{ items: GroupRow[] }>(
    `/api/report/group-mh?from=${from}&to=${to}`,
  );
  if (busy || !data) return <Loading />;

  const allHours = Array.from({ length: 14 }, (_, i) => i + 8);

  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="text-xs w-full">
          <thead className="bg-surface-base border-b border-surface-border">
            <tr>
              <th className="px-2 py-1.5 text-left text-3xs uppercase text-ink-subtle">
                グループ
              </th>
              {allHours.map((h) => (
                <th
                  key={h}
                  className="px-1 py-1.5 text-center text-3xs uppercase text-ink-subtle min-w-[40px] tabular-nums"
                >
                  {h}:00
                </th>
              ))}
              <th className="px-2 py-1.5 text-right text-3xs uppercase text-ink-subtle">
                合計
              </th>
              <th className="px-2 py-1.5 text-right text-3xs uppercase text-ink-subtle">
                MH
              </th>
              <th className="px-2 py-1.5 text-right text-3xs uppercase text-ink-subtle">
                MHT
              </th>
              <th className="px-2 py-1.5 text-right text-3xs uppercase text-ink-subtle">
                件/MHT
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={allHours.length + 5} className="text-center py-6 text-ink-muted">
                  データがありません
                </td>
              </tr>
            )}
            {data.items.map((g) => {
              const byHour = new Map(g.hourly.map((h) => [h.hour, h]));
              return (
                <tr key={g.groupId} className="border-t border-surface-border">
                  <td className="px-2 py-1 font-bold text-ink-strong">{g.groupName}</td>
                  {allHours.map((h) => {
                    const c = byHour.get(h)?.count ?? 0;
                    return (
                      <td
                        key={h}
                        className={cn(
                          'px-1 py-1 text-center font-mono tabular-nums',
                          c > 0 ? 'text-ink' : 'text-ink-muted',
                        )}
                      >
                        {c || ''}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right tabular-nums font-bold text-accent-amber">
                    {g.totalCount}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink">{g.totalMhHours}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink">{g.mhtHours}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink-subtle">
                    {g.perMht == null ? '—' : g.perMht}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-2 pb-2 text-3xs text-ink-muted leading-relaxed">
        MH＝検品着手〜完了の合計／MHT＝メンバー割当ガントの配置時間の合計。
        件/MHT は「配置されていた時間帯に完了した件数 ÷ 配置時間」で、グループは
        その時刻のガントで判定します（左の「合計」は担当者マスタの所属グループ基準のため、
        数が一致しないことがあります）。配置が未登録の期間は「—」になります。
      </p>
    </Panel>
  );
}

interface AbcRow {
  productCode: string;
  productName: string;
  category: string;
  orderCount: number;
  totalQty: number;
  cumRatio: number;
  abc: 'A' | 'B' | 'C';
}
function ProductAbcTab({ from, to }: { from: string; to: string }) {
  const { data, busy } = useReport<{ items: AbcRow[] }>(
    `/api/report/product-abc?from=${from}&to=${to}`,
  );
  if (busy || !data) return <Loading />;
  return (
    <Table>
      <THead>
        <TH align="center">ABC</TH>
        <TH>商品コード</TH>
        <TH>商品名</TH>
        <TH>カテゴリ</TH>
        <TH align="right">伝票数</TH>
        <TH align="right">合計数量</TH>
        <TH align="right">累積比率%</TH>
      </THead>
      <TBody>
        {data.items.length === 0 && <EmptyRow colSpan={7} />}
        {data.items.map((r) => (
          <TR key={r.productCode}>
            <TD align="center">
              <Badge variant={r.abc === 'A' ? 'done' : r.abc === 'B' ? 'warn' : 'neutral'} size="md">
                {r.abc}
              </Badge>
            </TD>
            <TD mono className="text-2xs">
              {r.productCode}
            </TD>
            <TD className="text-ink-strong">{r.productName}</TD>
            <TD className="text-2xs">{r.category}</TD>
            <TD align="right" mono>
              {r.orderCount}
            </TD>
            <TD align="right" mono className="font-bold text-accent-amber">
              {r.totalQty}
            </TD>
            <TD align="right" mono className="text-2xs text-ink-subtle">
              {r.cumRatio}%
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

interface HeatmapData {
  rows: Array<{ weekday: string; hour: number; count: number; level: 'low' | 'mid' | 'high' }>;
  carrierCutoffs: Array<{ carrier: string; cutoff: string; rushCount: number }>;
}
function HeatmapTab({ from, to }: { from: string; to: string }) {
  const { data, busy } = useReport<HeatmapData>(`/api/report/heatmap?from=${from}&to=${to}`);
  if (busy || !data) return <Loading />;

  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const hours = Array.from({ length: 11 }, (_, i) => i + 9);
  const cellMap = new Map<string, { count: number; level: 'low' | 'mid' | 'high' }>();
  for (const r of data.rows)
    cellMap.set(`${r.weekday}|${r.hour}`, { count: r.count, level: r.level });
  // 5 段階に拡張: max を計算して 5 分割
  const maxCount = Math.max(0, ...data.rows.map((r) => r.count));

  function densityClass(count: number): string {
    if (maxCount === 0 || count === 0) return 'bg-surface-base text-ink-muted';
    const ratio = count / maxCount;
    if (ratio >= 0.8) return 'bg-red-700 text-white';
    if (ratio >= 0.6) return 'bg-orange-600 text-white';
    if (ratio >= 0.4) return 'bg-amber-600 text-white';
    if (ratio >= 0.2) return 'bg-emerald-700 text-emerald-100';
    return 'bg-blue-900 text-blue-200';
  }

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader title="🌡 ヒートマップ" meta="5 段階カラースケール" />
        <div className="overflow-x-auto p-2">
          <table className="text-xs w-full">
            <thead>
              <tr>
                <th className="px-2 py-1 text-3xs text-ink-subtle uppercase">曜日 \ 時刻</th>
                {hours.map((h) => (
                  <th
                    key={h}
                    className="px-1 py-1 text-center text-3xs text-ink-subtle min-w-[44px] tabular-nums"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d}>
                  <td className="px-2 py-1 font-bold text-ink-strong">{d}</td>
                  {hours.map((h) => {
                    const c = cellMap.get(`${d}|${h}`);
                    const cls = densityClass(c?.count ?? 0);
                    return (
                      <td
                        key={h}
                        className={cn(
                          'px-2 py-1 text-center font-mono tabular-nums font-bold border border-surface-border',
                          cls,
                        )}
                      >
                        {c?.count ?? 0}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* レジェンド */}
          <div className="flex items-center gap-2 mt-3 text-3xs text-ink-subtle">
            <span>低</span>
            <span className="w-4 h-3 bg-blue-900" />
            <span className="w-4 h-3 bg-emerald-700" />
            <span className="w-4 h-3 bg-amber-600" />
            <span className="w-4 h-3 bg-orange-600" />
            <span className="w-4 h-3 bg-red-700" />
            <span>高</span>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="🚚 運送会社 締切駆け込み" meta="直前 60 分の梱包件数" />
        <Table>
          <THead>
            <TH>運送会社</TH>
            <TH>締切</TH>
            <TH align="right">駆け込み件数</TH>
          </THead>
          <TBody>
            {data.carrierCutoffs.length === 0 && <EmptyRow colSpan={3} />}
            {data.carrierCutoffs.map((c) => (
              <TR key={c.carrier}>
                <TD className="text-ink-strong">{c.carrier}</TD>
                <TD mono>{c.cutoff}</TD>
                <TD align="right" mono className="font-bold text-accent-amber">
                  {c.rushCount}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>
    </div>
  );
}

interface TimelineData {
  headers: string[];
  rows: string[][];
  total: number;
  shown: number;
  basis: string;
  airpackKeyword: string;
}

/**
 * 🧾 検品タイムライン（現場依頼・2026-09-17）
 *
 * 1伝票 = 1行。検品の着手／完了、担当者、商品点数、ステータス、のし、エアパックを
 * CSV で一括抽出する。保留・キャンセル（削除済）も含め、絞り込みは受領後に現場側で行う。
 *
 * 画面は**先頭 100 行の下見**だけ（数十万行になりうるため）。本体は CSV ボタンから。
 */
function InspTimelineTab({
  from,
  to,
  basis,
}: {
  from: string;
  to: string;
  basis: string;
}) {
  const { data, busy } = useReport<TimelineData>(
    `/api/report/insp-timeline?from=${from}&to=${to}&basis=${basis}&limit=100`,
  );
  if (busy || !data) return <Loading />;

  return (
    <div className="space-y-2">
      <Panel>
        <div className="p-3 text-xs text-ink leading-relaxed space-y-1">
          <div>
            <b className="text-accent-amber">{data.total.toLocaleString()} 件</b> が対象です（
            {basis === 'start' ? '検品着手日' : '出荷日'} が {from} 〜 {to}）。
            未検品・保留・削除済（キャンセル）も含みます。
          </div>
          <div className="text-ink-subtle">
            この画面は先頭 {data.shown} 行の下見です。全件は「📥 CSV出力」から取得してください。
          </div>
          {data.airpackKeyword === '' && (
            <div className="text-status-warn">
              ⚠ エアパックの判定語（マスタ管理 → 全体設定 → pack.airpack_keyword）が未設定のため、
              エアパック欄は空欄になります。
            </div>
          )}
        </div>
      </Panel>

      <Panel>
        <div className="overflow-x-auto">
          <table className="text-xs w-full">
            <thead className="bg-surface-base border-b border-surface-border">
              <tr>
                {data.headers.map((h) => (
                  <th
                    key={h}
                    className="px-2 py-1.5 text-left text-3xs uppercase text-ink-subtle whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={data.headers.length}
                    className="text-center py-6 text-ink-muted"
                  >
                    データがありません
                  </td>
                </tr>
              )}
              {data.rows.map((row) => (
                <tr key={row[1]} className="border-t border-surface-border">
                  {row.map((cell, i) => (
                    <td
                      key={data.headers[i]}
                      className={cn(
                        'px-2 py-1 whitespace-nowrap',
                        i === 1 ? 'font-mono text-ink-strong' : 'text-ink',
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Loading() {
  return (
    <div className="text-ink-muted text-sm flex items-center gap-2 py-6 justify-center">
      <span className="w-2 h-2 bg-accent-amber rounded-full animate-pulse" />
      読み込み中…
    </div>
  );
}
