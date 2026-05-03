'use client';

import { useEffect, useState } from 'react';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/form-controls';
import { cn } from '@/lib/cn';

interface Group {
  id: string;
  name: string;
}

interface StaffShift {
  staffCode: string;
  staffName: string;
  patternCode: string;
  startTime: string | null;
  endTime: string | null;
  /** 既定の所属グループ（任意） */
  defaultGroupId: string | null;
}

interface Assignment {
  staffCode: string;
  groupId: string;
  startTime: string;
  endTime: string;
}

interface ServerAssignment extends Assignment {
  id: number;
  staff: { code: string; name: string };
  group: { id: string; name: string };
}

const HOURS_FROM = 9;
const HOURS_TO = 18; // 18:00 まで
const SLOT_MIN = 30;
const SLOTS = ((HOURS_TO - HOURS_FROM) * 60) / SLOT_MIN; // 18 slots

function slotToTime(idx: number): string {
  const total = HOURS_FROM * 60 + idx * SLOT_MIN;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function AssignmentClient() {
  const [date, setDate] = useState(todayIso());
  const [groups, setGroups] = useState<Group[]>([]);
  const [todayShifts, setTodayShifts] = useState<StaffShift[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // マスタ + 当日シフト + 割当をロード
  async function loadAll() {
    setBusy(true);
    const [gRes, sRes, aRes] = await Promise.all([
      fetch('/api/master/inspection-groups').then((r) =>
        r.ok ? r.json() : { data: { items: [] } },
      ),
      fetch('/api/shifts/today').then((r) => r.json()),
      fetch(`/api/assignments?date=${date}`).then((r) => r.json()),
    ]);

    // groups 未実装の場合は inspection_groups を直接使うエンドポイントが無いため
    // /api/dashboard/progress 由来のグループ ID を流用するためのフォールバック
    let groupItems: Group[] = gRes.data?.items ?? [];
    if (groupItems.length === 0) {
      const dr = await fetch('/api/dashboard/progress').then((r) => r.json());
      groupItems = (dr.data?.groups ?? []).map((g: { groupId: string; groupName: string }) => ({
        id: g.groupId,
        name: g.groupName,
      }));
    }
    setGroups(groupItems);
    if (groupItems[0] && !activeGroupId) setActiveGroupId(groupItems[0].id);

    const shifts: StaffShift[] = (sRes.data?.items ?? []).map((s: {
      staffCode: string;
      staff: { name: string; groupId: string | null };
      patternCode: string;
      pattern: { startTime: string | null; endTime: string | null };
    }) => ({
      staffCode: s.staffCode,
      staffName: s.staff.name,
      patternCode: s.patternCode,
      startTime: s.pattern.startTime,
      endTime: s.pattern.endTime,
      defaultGroupId: s.staff.groupId,
    }));
    setTodayShifts(shifts);

    const remoteAssignments: Assignment[] = (aRes.data?.items ?? []).map((a: ServerAssignment) => ({
      staffCode: a.staffCode,
      groupId: a.groupId,
      startTime: a.startTime,
      endTime: a.endTime,
    }));
    setAssignments(remoteAssignments);

    setBusy(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // セル状態判定
  function cellAssigned(staffCode: string, slotIdx: number): string | null {
    const time = slotToTime(slotIdx);
    const hit = assignments.find(
      (a) => a.staffCode === staffCode && a.startTime <= time && time < a.endTime,
    );
    return hit?.groupId ?? null;
  }

  function toggleCell(staffCode: string, slotIdx: number) {
    if (!activeGroupId) return;
    const start = slotToTime(slotIdx);
    const end = slotToTime(slotIdx + 1);

    setAssignments((prev) => {
      // 同セル既割当のグループが activeGroupId と同じなら削除
      const existing = prev.find(
        (a) => a.staffCode === staffCode && a.startTime <= start && start < a.endTime,
      );
      if (existing && existing.groupId === activeGroupId) {
        // セルを 1 スロット分削る（前後があれば分割）
        const next = prev.filter((a) => a !== existing);
        if (existing.startTime < start) {
          next.push({ ...existing, endTime: start });
        }
        if (end < existing.endTime) {
          next.push({ ...existing, startTime: end });
        }
        return next;
      }

      // 別グループの割当があれば、そのスロットだけ削って新しい割当を追加
      let next = prev.filter(
        (a) => !(a.staffCode === staffCode && a.startTime <= start && start < a.endTime),
      );
      if (existing && existing.groupId !== activeGroupId) {
        if (existing.startTime < start) {
          next.push({ ...existing, endTime: start });
        }
        if (end < existing.endTime) {
          next.push({ ...existing, startTime: end });
        }
      }
      // 隣接（後ろ）と同グループならマージ
      const adjAfter = next.find(
        (a) => a.staffCode === staffCode && a.groupId === activeGroupId && a.startTime === end,
      );
      let mergedEnd = end;
      if (adjAfter) {
        mergedEnd = adjAfter.endTime;
        next = next.filter((a) => a !== adjAfter);
      }
      // 隣接（前）と同グループならマージ
      const adjBefore = next.find(
        (a) => a.staffCode === staffCode && a.groupId === activeGroupId && a.endTime === start,
      );
      let mergedStart = start;
      if (adjBefore) {
        mergedStart = adjBefore.startTime;
        next = next.filter((a) => a !== adjBefore);
      }
      next.push({ staffCode, groupId: activeGroupId, startTime: mergedStart, endTime: mergedEnd });
      return next;
    });
  }

  async function onSave() {
    setBusy(true);
    setStatusMsg(null);
    const res = await fetch('/api/assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, assignments }),
    });
    const j = await res.json();
    setBusy(false);
    if (res.ok) {
      setStatusMsg(`✅ 保存しました（${j.data.count} 件）`);
    } else {
      setStatusMsg(`❌ ${j.message ?? res.status}`);
    }
  }

  async function onClear() {
    if (!confirm(`${date} の割当を全クリアしますか？`)) return;
    setBusy(true);
    await fetch(`/api/assignments?date=${date}`, { method: 'DELETE' });
    setAssignments([]);
    setBusy(false);
    setStatusMsg('🧹 クリアしました');
  }

  async function onLoadYesterday() {
    setBusy(true);
    const res = await fetch('/api/assignments/load-yesterday', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    });
    const j = await res.json();
    setBusy(false);
    if (res.ok) {
      setStatusMsg(`📋 昨日の割当を ${j.data.copied} 件複製しました`);
      loadAll();
    } else {
      setStatusMsg(`❌ ${j.message}`);
    }
  }

  function onApplyShifts() {
    // 当日シフト出勤者を、所属グループ（なければ最初のグループ）の勤務時間に割り当てる
    if (groups.length === 0) {
      setStatusMsg('グループ情報がないため反映できません');
      return;
    }
    const next: Assignment[] = [];
    for (const s of todayShifts) {
      if (!s.startTime || !s.endTime) continue;
      const groupId = s.defaultGroupId ?? groups[0].id;
      next.push({
        staffCode: s.staffCode,
        groupId,
        startTime: s.startTime,
        endTime: s.endTime,
      });
    }
    setAssignments(next);
    setStatusMsg(`📅 当日シフトから ${next.length} 件を反映しました（保存ボタンで確定）`);
  }

  // === レンダリング ===
  const groupColor = (groupId: string) => {
    const idx = Math.max(0, groups.findIndex((g) => g.id === groupId));
    const palette = [
      'bg-blue-700 text-blue-100',
      'bg-emerald-700 text-emerald-100',
      'bg-amber-700 text-amber-100',
      'bg-pink-700 text-pink-100',
      'bg-purple-700 text-purple-100',
      'bg-orange-700 text-orange-100',
      'bg-cyan-700 text-cyan-100',
      'bg-rose-700 text-rose-100',
      'bg-indigo-700 text-indigo-100',
      'bg-teal-700 text-teal-100',
    ];
    return palette[idx % palette.length];
  };

  return (
    <div className="space-y-3">
      {/* 操作バー */}
      <Panel className="print:hidden">
        <div className="p-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="text-3xs text-ink-subtle uppercase tracking-wider block mb-1">
              対象日
            </label>
            <TextInput
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="!w-auto"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="text-3xs text-ink-subtle uppercase tracking-wider block mb-1">
              塗りつぶしグループ
            </label>
            <div className="flex gap-1 flex-wrap">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveGroupId(g.id)}
                  className={cn(
                    'px-2.5 py-1 rounded text-2xs font-bold transition-all',
                    activeGroupId === g.id
                      ? 'ring-2 ring-accent-amber scale-105'
                      : 'opacity-70 hover:opacity-100',
                    groupColor(g.id),
                  )}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={onLoadYesterday} disabled={busy} variant="ghost" size="sm">
            📋 昨日の割当
          </Button>
          <Button onClick={onApplyShifts} disabled={busy} variant="ghost" size="sm">
            📅 当日シフト
          </Button>
          <Button onClick={onClear} disabled={busy} variant="danger" size="sm">
            🧹 全クリア
          </Button>
          <Button onClick={() => window.print()} variant="ghost" size="sm">
            🖨 印刷
          </Button>
          <Button onClick={onSave} disabled={busy} size="sm">
            {busy ? '…' : '💾 保存'}
          </Button>
        </div>
      </Panel>
      {statusMsg && (
        <div className="text-xs text-ink bg-status-info-bg border border-status-info/40 rounded p-2">
          {statusMsg}
        </div>
      )}

      {/* Gantt 表 */}
      <Panel>
        <PanelHeader
          title="メンバー割当 Gantt"
          meta={`${todayShifts.length} 名 / ${assignments.length} 割当`}
        />
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead className="bg-surface-base">
              <tr>
                <th className="border border-surface-border px-2 py-1.5 sticky left-0 bg-surface-base z-10 whitespace-nowrap text-ink-subtle text-2xs uppercase">
                  担当者
                </th>
                {Array.from({ length: SLOTS }).map((_, i) => (
                  <th
                    key={i}
                    className={cn(
                      'border border-surface-border w-8 text-center font-normal text-3xs',
                      i % 2 === 0 ? 'bg-surface-raised text-ink-subtle' : 'text-ink-muted',
                    )}
                  >
                    {i % 2 === 0 ? slotToTime(i) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {todayShifts.length === 0 && (
                <tr>
                  <td colSpan={SLOTS + 1} className="text-center text-ink-muted py-8 text-sm">
                    当日シフトがありません（先に /shift で取込んでください）
                  </td>
                </tr>
              )}
              {todayShifts.map((s) => (
                <tr key={s.staffCode}>
                  <td className="border border-surface-border px-2 py-1 sticky left-0 bg-surface-panel z-10 whitespace-nowrap">
                    <div className="font-bold text-ink-strong">{s.staffName}</div>
                    <div className="text-3xs text-ink-muted font-mono">
                      {s.patternCode} {s.startTime}-{s.endTime}
                    </div>
                  </td>
                  {Array.from({ length: SLOTS }).map((_, i) => {
                    const gId = cellAssigned(s.staffCode, i);
                    const inShift =
                      s.startTime &&
                      s.endTime &&
                      slotToTime(i) >= s.startTime &&
                      slotToTime(i) < s.endTime;
                    return (
                      <td
                        key={i}
                        onClick={() => toggleCell(s.staffCode, i)}
                        className={cn(
                          'border border-surface-border w-8 h-7 cursor-pointer text-center text-3xs font-bold transition-opacity hover:opacity-70',
                          gId
                            ? groupColor(gId)
                            : inShift
                              ? 'bg-blue-950/50'
                              : 'bg-surface-base',
                        )}
                        title={`${s.staffName} / ${slotToTime(i)} ${gId ?? ''}`}
                      >
                        {gId &&
                          (groups.find((g) => g.id === gId)?.name?.[0] ?? '')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="text-2xs text-ink-muted print:hidden">
        セルをクリックすると現在選択中のグループ色で塗ります。同じグループのセルを再クリックで解除。
        ドラッグ&ドロップは Phase 7-5 残作業で対応予定です。
      </p>
    </div>
  );
}
