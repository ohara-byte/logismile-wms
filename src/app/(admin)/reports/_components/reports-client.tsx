'use client';

import { useEffect, useState } from 'react';

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
] as const;

type TabId = (typeof TABS)[number]['id'];

export function ReportsClient() {
  const [from, setFrom] = useState(addDays(todayIso(), -30));
  const [to, setTo] = useState(todayIso());
  const [tab, setTab] = useState<TabId>('summary');

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-lg p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-gray-500 block">期間 From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex-1" />
        {tab !== 'heatmap' && (
          <a
            href={`/api/report/export?type=${tab}&from=${from}&to=${to}`}
            className="px-3 py-1.5 border rounded text-sm bg-white hover:bg-gray-50"
          >
            📥 CSV出力
          </a>
        )}
      </div>

      <div className="border-b flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 ${
              tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600'
            }`}
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
  if (busy || !data) return <div className="text-gray-500">読み込み中…</div>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
      <Stat label="出荷件数" value={data.totalShipped} />
      <Stat label="梱包完了" value={data.totalPacked} color="green" />
      <Stat label="完了セッション" value={data.completedCount} />
      <Stat label="強制OK" value={data.forceOkCount} color="orange" />
      <Stat
        label="平均梱包秒"
        value={data.avgPackingSec ?? '—'}
        color="gray"
      />
      <Stat label="総MH(h)" value={data.totalMhHours} />
    </div>
  );
}

interface StaffRow {
  staffCode: string;
  staffName: string;
  count: number;
  durationSec: number;
  mhHours: number;
  avgSec: number;
}
function StaffMhTab({ from, to }: { from: string; to: string }) {
  const { data, busy } = useReport<{ items: StaffRow[] }>(
    `/api/report/staff-mh?from=${from}&to=${to}`,
  );
  if (busy || !data) return <div className="text-gray-500">読み込み中…</div>;
  return (
    <table className="w-full text-sm border bg-white">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-2 py-1 text-left">担当者</th>
          <th className="px-2 py-1 text-right">件数</th>
          <th className="px-2 py-1 text-right">作業時間(秒)</th>
          <th className="px-2 py-1 text-right">MH(h)</th>
          <th className="px-2 py-1 text-right">平均秒/件</th>
        </tr>
      </thead>
      <tbody>
        {data.items.length === 0 && (
          <tr>
            <td colSpan={5} className="text-center py-4 text-gray-400">
              データがありません
            </td>
          </tr>
        )}
        {data.items.map((r) => (
          <tr key={r.staffCode} className="border-t">
            <td className="px-2 py-1">{r.staffName}</td>
            <td className="px-2 py-1 text-right">{r.count}</td>
            <td className="px-2 py-1 text-right">{r.durationSec.toLocaleString()}</td>
            <td className="px-2 py-1 text-right font-medium">{r.mhHours}</td>
            <td className="px-2 py-1 text-right">{r.avgSec}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface GroupRow {
  groupId: string;
  groupName: string;
  hourly: { hour: number; count: number; mhHours: number }[];
  totalCount: number;
  totalMhHours: number;
}
function GroupMhTab({ from, to }: { from: string; to: string }) {
  const { data, busy } = useReport<{ items: GroupRow[] }>(
    `/api/report/group-mh?from=${from}&to=${to}`,
  );
  if (busy || !data) return <div className="text-gray-500">読み込み中…</div>;

  const allHours = Array.from({ length: 14 }, (_, i) => i + 8); // 8-21

  return (
    <div className="overflow-x-auto bg-white border rounded-lg">
      <table className="text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-2 py-1 text-left">グループ</th>
            {allHours.map((h) => (
              <th key={h} className="px-2 py-1 text-center min-w-[40px]">
                {h}:00
              </th>
            ))}
            <th className="px-2 py-1 text-right">合計件数</th>
            <th className="px-2 py-1 text-right">MH</th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 && (
            <tr>
              <td colSpan={allHours.length + 3} className="text-center py-4 text-gray-400">
                データがありません
              </td>
            </tr>
          )}
          {data.items.map((g) => {
            const byHour = new Map(g.hourly.map((h) => [h.hour, h]));
            return (
              <tr key={g.groupId} className="border-t">
                <td className="px-2 py-1">{g.groupName}</td>
                {allHours.map((h) => (
                  <td key={h} className="px-2 py-1 text-center">
                    {byHour.get(h)?.count ?? ''}
                  </td>
                ))}
                <td className="px-2 py-1 text-right font-medium">{g.totalCount}</td>
                <td className="px-2 py-1 text-right">{g.totalMhHours}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  if (busy || !data) return <div className="text-gray-500">読み込み中…</div>;
  return (
    <table className="w-full text-sm border bg-white">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-2 py-1 text-center">ABC</th>
          <th className="px-2 py-1 text-left">商品コード</th>
          <th className="px-2 py-1 text-left">商品名</th>
          <th className="px-2 py-1 text-left">カテゴリ</th>
          <th className="px-2 py-1 text-right">伝票数</th>
          <th className="px-2 py-1 text-right">合計数量</th>
          <th className="px-2 py-1 text-right">累積比率%</th>
        </tr>
      </thead>
      <tbody>
        {data.items.length === 0 && (
          <tr>
            <td colSpan={7} className="text-center py-4 text-gray-400">
              データがありません
            </td>
          </tr>
        )}
        {data.items.map((r) => (
          <tr key={r.productCode} className="border-t">
            <td className="px-2 py-1 text-center">
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded ${
                  r.abc === 'A'
                    ? 'bg-green-200 text-green-900'
                    : r.abc === 'B'
                      ? 'bg-yellow-200 text-yellow-900'
                      : 'bg-gray-200 text-gray-700'
                }`}
              >
                {r.abc}
              </span>
            </td>
            <td className="px-2 py-1 font-mono text-xs">{r.productCode}</td>
            <td className="px-2 py-1">{r.productName}</td>
            <td className="px-2 py-1 text-xs">{r.category}</td>
            <td className="px-2 py-1 text-right">{r.orderCount}</td>
            <td className="px-2 py-1 text-right font-medium">{r.totalQty}</td>
            <td className="px-2 py-1 text-right text-xs text-gray-600">{r.cumRatio}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface HeatmapData {
  rows: Array<{ weekday: string; hour: number; count: number; level: 'low' | 'mid' | 'high' }>;
  carrierCutoffs: Array<{ carrier: string; cutoff: string; rushCount: number }>;
}
function HeatmapTab({ from, to }: { from: string; to: string }) {
  const { data, busy } = useReport<HeatmapData>(`/api/report/heatmap?from=${from}&to=${to}`);
  if (busy || !data) return <div className="text-gray-500">読み込み中…</div>;

  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const hours = Array.from({ length: 11 }, (_, i) => i + 9); // 9-19
  const cellMap = new Map<string, { count: number; level: 'low' | 'mid' | 'high' }>();
  for (const r of data.rows) cellMap.set(`${r.weekday}|${r.hour}`, { count: r.count, level: r.level });

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-lg p-3 overflow-x-auto">
        <table className="text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-1">曜日 \ 時刻</th>
              {hours.map((h) => (
                <th key={h} className="px-2 py-1 text-center min-w-[44px]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <td className="px-2 py-1 font-medium">{d}</td>
                {hours.map((h) => {
                  const c = cellMap.get(`${d}|${h}`);
                  const bg =
                    c?.level === 'high'
                      ? 'bg-red-300'
                      : c?.level === 'mid'
                        ? 'bg-yellow-200'
                        : (c?.count ?? 0) > 0
                          ? 'bg-green-100'
                          : 'bg-gray-50';
                  return (
                    <td key={h} className={`px-2 py-1 text-center ${bg}`}>
                      {c?.count ?? 0}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-white border rounded-lg p-3">
        <h3 className="font-semibold mb-2 text-sm">運送会社 締切駆け込み（直前60分の梱包件数）</h3>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs">
            <tr>
              <th className="px-2 py-1 text-left">運送会社</th>
              <th className="px-2 py-1 text-left">締切</th>
              <th className="px-2 py-1 text-right">駆け込み件数</th>
            </tr>
          </thead>
          <tbody>
            {data.carrierCutoffs.map((c) => (
              <tr key={c.carrier} className="border-t">
                <td className="px-2 py-1">{c.carrier}</td>
                <td className="px-2 py-1">{c.cutoff}</td>
                <td className="px-2 py-1 text-right font-medium">{c.rushCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color = 'gray',
}: {
  label: string;
  value: number | string;
  color?: 'gray' | 'green' | 'orange';
}) {
  const colorMap: Record<string, string> = {
    gray: 'text-gray-700',
    green: 'text-green-700',
    orange: 'text-orange-700',
  };
  return (
    <div className="border rounded-lg bg-white p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${colorMap[color]}`}>{value}</div>
    </div>
  );
}
