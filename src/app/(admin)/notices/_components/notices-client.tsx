'use client';

import { useEffect, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { TextInput, NumberInput, Select, Textarea, FieldLabel } from '@/components/ui/form-controls';
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';

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
      alert((await res.json()).message ?? `エラー: HTTP ${res.status}`);
    }
  }

  async function onDeactivate(id: number) {
    if (!confirm('この連絡事項を無効化しますか？')) return;
    await fetch(`/api/notices/${id}`, { method: 'DELETE' });
    reload();
  }

  return (
    <div className="space-y-3">
      {/* 新規作成 */}
      <Panel>
        <PanelHeader title="新規連絡事項" />
        <PanelBody>
          <form onSubmit={onCreate} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <FieldLabel required>対象日</FieldLabel>
              <TextInput
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel>優先度（0-100、高いほど上）</FieldLabel>
              <NumberInput
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value, 10) || 50)}
              />
            </div>
            <div className="md:col-span-2">
              <FieldLabel required>タイトル</FieldLabel>
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="md:col-span-2">
              <FieldLabel>本文（任意）</FieldLabel>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
              />
            </div>
            <div>
              <FieldLabel>対象範囲</FieldLabel>
              <Select
                value={targetType}
                onChange={(e) => setTargetType(e.target.value as 'all' | 'group' | 'table')}
              >
                <option value="all">全員</option>
                <option value="group">グループ</option>
                <option value="table">テーブル</option>
              </Select>
            </div>
            <div>
              <FieldLabel>対象ID（group/table 時）</FieldLabel>
              <TextInput
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="ABL"
                disabled={targetType === 'all'}
              />
            </div>
            <div className="md:col-span-2 text-right">
              <Button type="submit" disabled={busy || !title}>
                {busy ? '…' : '登録'}
              </Button>
            </div>
          </form>
        </PanelBody>
      </Panel>

      {/* 一覧 */}
      <Panel>
        <PanelHeader title={`${date} の連絡事項`} meta={`${items.length} 件`} />
        <Table>
          <THead>
            <TH align="center">優先</TH>
            <TH>対象</TH>
            <TH>タイトル</TH>
            <TH>本文</TH>
            <TH>{''}</TH>
          </THead>
          <TBody>
            {items.length === 0 && (
              <EmptyRow colSpan={5} message="この日付の連絡事項はありません" />
            )}
            {items.map((n) => (
              <TR key={n.id}>
                <TD align="center" mono>
                  <Badge variant={n.priority >= 80 ? 'error' : n.priority >= 50 ? 'warn' : 'neutral'}>
                    {n.priority}
                  </Badge>
                </TD>
                <TD className="text-2xs">
                  {n.targetType === 'all' ? '全員' : `${n.targetType}: ${n.targetId ?? '—'}`}
                </TD>
                <TD className="font-bold text-ink-strong">{n.title}</TD>
                <TD className="text-2xs text-ink-subtle max-w-md truncate">{n.body ?? '—'}</TD>
                <TD align="right">
                  <button
                    onClick={() => onDeactivate(n.id)}
                    className="text-2xs text-status-error hover:underline"
                  >
                    無効化
                  </button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>
    </div>
  );
}
