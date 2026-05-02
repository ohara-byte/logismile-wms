'use client';

import { useEffect, useState } from 'react';

interface Overall {
  date: string;
  total: number;
  packed: number;
  pending: number;
  inspecting: number;
  held: number;
  forceOkCount: number;
  completionRate: number;
  recentRate: number;
  avgDurationSec: number | null;
}

interface Group {
  groupId: string;
  groupName: string;
  assignedStaff: number;
  hourlyCapacity: number;
  remaining: number;
  etaTime: string | null;
  delayFlag: boolean;
}

interface HourlyPoint {
  hour: number;
  target: number;
  actual: number;
}

interface Alert {
  id: number;
  type: string;
  severity: string;
  title: string;
  body: string | null;
  refCode: string | null;
  resolved: boolean;
  createdAt: string;
}

export function DashboardClient() {
  const [data, setData] = useState<{
    overall: Overall;
    groups: Group[];
    hourly: HourlyPoint[];
  } | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [pr, ar] = await Promise.all([
        fetch('/api/dashboard/progress').then((r) => r.json()),
        fetch('/api/alerts?resolved=false').then((r) => r.json()),
      ]);
      if (pr.data) setData(pr.data);
      if (ar.data) setAlerts(ar.data.items);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    reload();
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, []);

  async function resolveAlert(id: number) {
    await fetch(`/api/alerts/${id}/resolve`, { method: 'PUT' });
    reload();
  }

  if (!data) {
    return <div className="text-gray-500">読み込み中…</div>;
  }

  const { overall, groups, hourly } = data;

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>
      )}

      {/* 全体進捗 */}
      <section>
        <h2 className="text-lg font-semibold mb-2">本日の出荷進捗 ({overall.date})</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <Stat label="総件数" value={overall.total} />
          <Stat label="完了" value={overall.packed} color="green" />
          <Stat label="未着手" value={overall.pending} />
          <Stat label="検品中" value={overall.inspecting} color="blue" />
          <Stat label="保留" value={overall.held} color="orange" />
          <Stat label="完了率" value={`${overall.completionRate}%`} color={overall.completionRate >= 80 ? 'green' : 'gray'} />
          <Stat
            label="直近30分"
            value={overall.recentRate}
            color={overall.recentRate < 5 && overall.pending > 50 ? 'red' : 'gray'}
          />
        </div>
        <div className="text-xs text-gray-500 mt-2">
          平均梱包時間: {overall.avgDurationSec ? `${overall.avgDurationSec}秒` : '—'} / 強制OK: {overall.forceOkCount}件
        </div>
      </section>

      {/* 段階目標 vs 予測 */}
      <section>
        <h2 className="text-lg font-semibold mb-2">段階目標 vs 実績（時刻別累積）</h2>
        <div className="bg-white border rounded-lg p-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="text-left">時刻</th>
                {hourly.map((p) => (
                  <th key={p.hour} className="text-center px-1 min-w-[36px]">
                    {p.hour}:00
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-gray-500">目標</td>
                {hourly.map((p) => (
                  <td key={p.hour} className="text-center text-gray-600">
                    {p.target}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="text-gray-500">実績</td>
                {hourly.map((p) => (
                  <td
                    key={p.hour}
                    className={`text-center font-medium ${
                      p.actual < p.target ? 'text-red-600' : 'text-green-700'
                    }`}
                  >
                    {p.actual}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* グループ別進捗 */}
      <section>
        <h2 className="text-lg font-semibold mb-2">グループ別進捗</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {groups.map((g) => (
            <div
              key={g.groupId}
              className={`bg-white border rounded-lg p-4 ${
                g.delayFlag ? 'border-red-300 bg-red-50' : ''
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <strong>{g.groupName}</strong>
                {g.delayFlag && (
                  <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded">
                    遅延
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-gray-500">配置</div>
                <div className="text-right">{g.assignedStaff} 名</div>
                <div className="text-gray-500">時間処理</div>
                <div className="text-right">{g.hourlyCapacity} 件/h</div>
                <div className="text-gray-500">残件</div>
                <div className="text-right">{g.remaining}</div>
                <div className="text-gray-500">終了予定</div>
                <div className={`text-right font-medium ${g.delayFlag ? 'text-red-700' : ''}`}>
                  {g.etaTime ?? '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* アラート */}
      <section>
        <h2 className="text-lg font-semibold mb-2">未解決アラート ({alerts.length})</h2>
        <div className="bg-white border rounded-lg overflow-hidden">
          {alerts.length === 0 ? (
            <p className="p-4 text-center text-gray-400 text-sm">未解決アラートはありません</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">種別</th>
                  <th className="px-3 py-2 text-left">重要度</th>
                  <th className="px-3 py-2 text-left">タイトル</th>
                  <th className="px-3 py-2 text-left">参照</th>
                  <th className="px-3 py-2 text-left">作成</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{a.type}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          a.severity === 'error'
                            ? 'bg-red-100 text-red-700'
                            : a.severity === 'warn'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {a.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div>{a.title}</div>
                      {a.body && <div className="text-xs text-gray-500">{a.body}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{a.refCode ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {new Date(a.createdAt).toLocaleString('ja-JP')}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => resolveAlert(a.id)}
                        className="text-blue-600 text-xs hover:underline"
                      >
                        解決
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
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
  color?: 'gray' | 'green' | 'red' | 'blue' | 'orange';
}) {
  const colorMap: Record<string, string> = {
    gray: 'text-gray-700',
    green: 'text-green-700',
    red: 'text-red-700',
    blue: 'text-blue-700',
    orange: 'text-orange-700',
  };
  return (
    <div className="border rounded-lg bg-white p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${colorMap[color]}`}>{value}</div>
    </div>
  );
}
