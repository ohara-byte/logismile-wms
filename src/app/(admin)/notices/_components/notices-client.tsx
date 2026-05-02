'use client';

import { useEffect, useState } from 'react';

interface Notice {
  id: number;
  date: string;
  title: string;
  body: string | null;
  targetType: string;
  targetId: string | null;
  priority: number;
  active: boolean;
  createdAt: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function NoticesClient() {
  const [date, setDate] = useState(todayIso());
  const [items, setItems] = useState<Notice[]>([]);
  const [busy, setBusy] = useState(false);

  // 新規作成フォーム
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetType, setTargetType] = useState<'all' | 'group' | 'table'>('all');
  const [targetId, setTargetId] = useState('');
  const [priority, setPriority] = useState(50);

  async function reload() {
    const res = await fetch(`/api/notices?date=${date}`);
    const j = await res.json();
    setItems(j.data?.items ?? []);
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/notices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        title,
        body: body || null,
        targetType,
        targetId: targetType === 'all' ? null : targetId || null,
        priority,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setTitle('');
      setBody('');
      setTargetId('');
      setPriority(50);
      reload();
    } else {
      const j = await res.json();
      alert(j.message ?? `エラー: HTTP ${res.status}`);
    }
  }

  async function onDeactivate(id: number) {
    if (!confirm('この連絡事項を無効化しますか？')) return;
    await fetch(`/api/notices/${id}`, { method: 'DELETE' });
    reload();
  }

  return (
    <div className="space-y-4">
      {/* 新規作成 */}
      <div className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-3">新規連絡事項</h2>
        <form onSubmit={onCreate} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <label className="text-xs text-gray-500">対象日</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border rounded px-2 py-1.5"
              required
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">優先度（0-100、高いほど上）</label>
            <input
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value, 10) || 50)}
              className="w-full border rounded px-2 py-1.5"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-gray-500">タイトル</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded px-2 py-1.5"
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-gray-500">本文（任意）</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full border rounded px-2 py-1.5"
              rows={3}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">対象範囲</label>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as 'all' | 'group' | 'table')}
              className="w-full border rounded px-2 py-1.5"
            >
              <option value="all">全員</option>
              <option value="group">グループ</option>
              <option value="table">テーブル</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">対象ID（group/table 時）</label>
            <input
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full border rounded px-2 py-1.5"
              placeholder="ABL"
              disabled={targetType === 'all'}
            />
          </div>
          <div className="md:col-span-2 text-right">
            <button
              type="submit"
              disabled={busy || !title}
              className="px-4 py-2 bg-blue-600 text-white rounded font-medium disabled:bg-gray-300"
            >
              {busy ? '…' : '登録'}
            </button>
          </div>
        </form>
      </div>

      {/* 一覧 */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-gray-50 text-xs text-gray-600 border-b">
          {date} の連絡事項 ({items.length})
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">優先</th>
              <th className="px-3 py-2 text-left">対象</th>
              <th className="px-3 py-2 text-left">タイトル</th>
              <th className="px-3 py-2 text-left">本文</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-400">
                  この日付の連絡事項はありません
                </td>
              </tr>
            )}
            {items.map((n) => (
              <tr key={n.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{n.priority}</td>
                <td className="px-3 py-2 text-xs">
                  {n.targetType === 'all' ? '全員' : `${n.targetType}: ${n.targetId ?? '—'}`}
                </td>
                <td className="px-3 py-2 font-medium">{n.title}</td>
                <td className="px-3 py-2 text-xs text-gray-600 max-w-md truncate">
                  {n.body ?? '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => onDeactivate(n.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    無効化
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
