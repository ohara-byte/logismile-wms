'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/form-controls';
import { cn } from '@/lib/cn';
import { normalizeHHMM } from '@/lib/date-utils';

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
  /** Sprint O: 休みフラグ（pattern.isOff） */
  isOff: boolean;
}

type FilterMode = 'working' | 'all' | 'unset' | 'off' | 'assigned';

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

// 2026-05-20: 休み判定の保険として、パターンコード名でも休みを判別する。
//   通常は pattern.is_off=true で判定可能だが、マスタデータ不整合への防御として
//   既知の休みパターンコードもハードコードしておく。
const KNOWN_OFF_PATTERNS = new Set(['公休', '有休', '希休', '特休', '欠勤']);

function slotToTime(idx: number): string {
  const total = HOURS_FROM * 60 + idx * SLOT_MIN;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

interface AssignmentClientProps {
  /** Sprint Y-13: モーダル等の親に現在の対象日を通知（タイトル更新に使う） */
  onDateChange?: (date: string) => void;
  /** 親から初期日を指定したい場合 */
  initialDate?: string;
  /**
   * 2026-05-20: 白背景テーマ（メンバー割当モーダル用）。
   *  - 既定 'dark' は従来のダークテーマ（/assignment 単体ページ用）
   *  - 'light' でモーダル内に埋め込む際の白基調テーマに切替
   */
  theme?: 'dark' | 'light';
}

export function AssignmentClient({
  onDateChange,
  initialDate,
  theme = 'dark',
}: AssignmentClientProps = {}) {
  const [date, setDate] = useState(initialDate ?? todayIso());
  const light = theme === 'light';

  // 対象日が変わったら親に通知
  useEffect(() => {
    onDateChange?.(date);
  }, [date, onDateChange]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [todayShifts, setTodayShifts] = useState<StaffShift[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Sprint O: ピッカー / フィルター
  // Sprint Q: 既定は「出勤予定者のみ」（休みは別プールに表示）
  const [filterMode, setFilterMode] = useState<FilterMode>('working');
  // Sprint Q: 休みメンバーを手動でプールに追加して割当可能にする救済モード
  const [forceAssignableSet, setForceAssignableSet] = useState<Set<string>>(new Set());

  // Sprint R: シフト外（他部署ヘルプ・短期バイト等）を手動でプール追加
  const [allStaff, setAllStaff] = useState<
    Array<{
      code: string;
      empCode: string;
      name: string;
      groupId: string | null;
      employmentTypeCode: string | null;
      active: boolean;
      assignable: boolean;
    }>
  >([]);
  /** ヘルプ要員として追加された staffCode のセット（シフト外）。
   *  StaffShift 風の合成エントリとして merge して扱う。 */
  const [externalHelpers, setExternalHelpers] = useState<StaffShift[]>([]);
  const [helperPickerOpen, setHelperPickerOpen] = useState(false);
  const [helperFilterText, setHelperFilterText] = useState('');
  const [picker, setPicker] = useState<{
    staffCode: string;
    staffName: string;
    groupId: string;
    startTime: string;
    endTime: string;
    /** 既存割当を編集する場合のインデックス（undefined なら新規追加） */
    editIndex?: number;
  } | null>(null);

  function openPicker(staff: StaffShift) {
    if (staff.isOff && !forceAssignableSet.has(staff.staffCode)) {
      const ok = confirm(
        `${staff.staffName} さんは休み設定です（${staff.patternCode}）。\n\n出勤に切替えて割当しますか？（ヘルプ要員等）\n→ OK で「出勤予定」プールに移動して割当ピッカーを開きます。`,
      );
      if (!ok) return;
      setForceAssignableSet((prev) => new Set(prev).add(staff.staffCode));
      // alert で押されたあとに picker を開きたいので、setForceAssignableSet 直後に進める
    }
    // 既定値: シフトの startTime/endTime か、9:00-17:00
    const defaultStart = staff.startTime ?? '09:00';
    const defaultEnd = staff.endTime ?? '17:00';
    const defaultGroup =
      staff.defaultGroupId && groups.some((g) => g.id === staff.defaultGroupId)
        ? staff.defaultGroupId
        : (activeGroupId ?? groups[0]?.id ?? '');
    setPicker({
      staffCode: staff.staffCode,
      staffName: staff.staffName,
      groupId: defaultGroup,
      startTime: defaultStart,
      endTime: defaultEnd,
    });
  }

  function pickerSubmit() {
    if (!picker) return;
    if (picker.endTime <= picker.startTime) {
      alert('終了時刻は開始時刻より後にしてください');
      return;
    }
    if (!picker.groupId) {
      alert('グループを選択してください');
      return;
    }
    setAssignments((prev) => {
      if (picker.editIndex !== undefined) {
        // 既存バーを上書き
        const next = [...prev];
        next[picker.editIndex] = {
          staffCode: picker.staffCode,
          groupId: picker.groupId,
          startTime: picker.startTime,
          endTime: picker.endTime,
        };
        return next;
      }
      // 新規追加
      return [
        ...prev,
        {
          staffCode: picker.staffCode,
          groupId: picker.groupId,
          startTime: picker.startTime,
          endTime: picker.endTime,
        },
      ];
    });
    setPicker(null);
  }

  /** 既存割当バーをダブルクリックで編集する */
  function editAssignment(index: number) {
    const a = assignments[index];
    if (!a) return;
    const shift = todayShifts.find((s) => s.staffCode === a.staffCode);
    setPicker({
      staffCode: a.staffCode,
      staffName: shift?.staffName ?? a.staffCode,
      groupId: a.groupId,
      startTime: a.startTime,
      endTime: a.endTime,
      editIndex: index,
    });
  }

  // マスタ + 当日シフト + 割当をロード
  async function loadAll() {
    setBusy(true);
    const [gRes, sRes, aRes, stRes] = await Promise.all([
      fetch('/api/master/inspection-groups').then((r) =>
        r.ok ? r.json() : { data: { items: [] } },
      ),
      // Sprint Y-13: 対象日のシフトを取得（未来日設定対応）
      fetch(`/api/shifts/today?date=${date}`).then((r) => r.json()),
      fetch(`/api/assignments?date=${date}`).then((r) => r.json()),
      // Sprint R: ヘルプ要員ピッカー用に担当者マスタ全件をロード
      fetch('/api/master/staff').then((r) => r.json()),
    ]);
    setAllStaff(
      (stRes.data?.items ?? []).filter(
        (s: { active: boolean }) => s.active !== false,
      ),
    );

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
      pattern: {
        startTime: string | null;
        endTime: string | null;
        isOff: boolean | null;
      };
    }) => ({
      staffCode: s.staffCode,
      staffName: s.staff.name,
      patternCode: s.patternCode,
      startTime: s.pattern.startTime,
      endTime: s.pattern.endTime,
      defaultGroupId: s.staff.groupId,
      // 2026-05-20: pattern.isOff に加え、パターンコード名でも休みを判定（防御）
      isOff: !!s.pattern.isOff || KNOWN_OFF_PATTERNS.has(s.patternCode),
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

  // 旧 cellAssigned/toggleCell は N-1〜N-3 のバー化により撤去（履歴は git で参照可能）。

  async function onSave() {
    setBusy(true);
    setStatusMsg(null);
    // 送信前サニタイズ：時刻を正準 "HH:MM" に正規化し、欠損/不正な割当は保存前に検出する。
    //   （コロン無し "1700" や単桁 "8:0" 等の表記ゆれが混じったまま飛ぶと、API の Zod 検証が
    //     422 を返す。normalizeHHMM で "1700"→"17:00" 等に整えて保存成功＆値を自己修復する。）
    const cleaned = assignments.map((a) => ({
      staffCode: (a.staffCode ?? '').trim(),
      groupId: (a.groupId ?? '').trim(),
      startTime: normalizeHHMM(a.startTime),
      endTime: normalizeHHMM(a.endTime),
    }));
    const bad = cleaned.find(
      (a) => !a.staffCode || !a.groupId || !a.startTime || !a.endTime,
    );
    if (bad) {
      setBusy(false);
      const who =
        todayShifts.find((s) => s.staffCode === bad.staffCode)?.staffName ??
        (bad.staffCode || '(不明なメンバー)');
      setStatusMsg(
        `❌ 割当に不備があるため保存できません（${who}）。グループ・開始・終了時刻を確認してください。`,
      );
      return;
    }
    const res = await fetch('/api/assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, assignments: cleaned }),
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

  // === モック準拠 グループ色マップ（管理用PCモック_v0.22.html L817-826） ===
  // 既知の ID は固定色、未知 ID は palette でフォールバック
  const GROUP_COLOR_FIXED: Record<string, { bg: string; fg: string }> = {
    ABL: { bg: '#64748b', fg: '#ffffff' },
    SC: { bg: '#fb923c', fg: '#0f172a' },
    DE: { bg: '#facc15', fg: '#0f172a' },
    FJK: { bg: '#22c55e', fg: '#ffffff' },
    H: { bg: '#3b82f6', fg: '#ffffff' },
    I: { bg: '#ef4444', fg: '#ffffff' },
    RQ: { bg: '#a78bfa', fg: '#0f172a' },
    LINE: { bg: '#0e7490', fg: '#ffffff' },
    SORT: { bg: '#b45309', fg: '#ffffff' },
    SAS: { bg: '#6d28d9', fg: '#ffffff' },
  };
  const FALLBACK_PALETTE = [
    { bg: '#64748b', fg: '#ffffff' },
    { bg: '#fb923c', fg: '#0f172a' },
    { bg: '#facc15', fg: '#0f172a' },
    { bg: '#22c55e', fg: '#ffffff' },
    { bg: '#3b82f6', fg: '#ffffff' },
    { bg: '#ef4444', fg: '#ffffff' },
    { bg: '#a78bfa', fg: '#0f172a' },
    { bg: '#0e7490', fg: '#ffffff' },
    { bg: '#b45309', fg: '#ffffff' },
    { bg: '#6d28d9', fg: '#ffffff' },
  ];
  const groupColorRgb = (groupId: string): { bg: string; fg: string } => {
    if (GROUP_COLOR_FIXED[groupId]) return GROUP_COLOR_FIXED[groupId];
    const idx = Math.max(0, groups.findIndex((g) => g.id === groupId));
    return FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
  };

  // ====== N-2: バー ドラッグ/リサイズ 共通ハンドラ ======
  // 時刻 ↔ スロット index 変換
  const timeToSlot = useCallback((t: string): number => {
    const [h, m] = t.split(':').map((s) => parseInt(s, 10));
    return (h - HOURS_FROM) * 2 + (m >= 30 ? 1 : 0);
  }, []);

  /** 1 スロット (30 分) の幅をピクセルで取得（track 要素の clientWidth から計算） */
  function slotPxFromTrack(trackEl: HTMLElement): number {
    return trackEl.clientWidth / SLOTS;
  }

  function deleteBar(targetIdx: number) {
    if (!confirm('この時間帯の割当を削除しますか？')) return;
    setAssignments((prev) => prev.filter((_, i) => i !== targetIdx));
  }

  /** 共通ポインタドラッグ。mode: 'move' = 全体移動 / 'lh' = 左端 / 'rh' = 右端
   *  Bug fix (Sprint Q): 旧実装は `prev.map((a) => a === target ...)` で
   *  参照比較していたが、setAssignments により毎回新オブジェクトに置換される
   *  ため 2 回目以降の onMove で更新が走らない。インデックス基準に修正。 */
  function startBarPointer(
    e: React.PointerEvent<HTMLElement>,
    targetIdx: number,
    mode: 'move' | 'lh' | 'rh',
  ) {
    e.preventDefault();
    e.stopPropagation();
    const trackEl = (e.currentTarget.closest('[data-track]') as HTMLElement) ?? null;
    if (!trackEl) return;
    const slotPx = slotPxFromTrack(trackEl);
    if (slotPx <= 0) return;
    const startX = e.clientX;
    // 開始時点の startTime/endTime を「現在の state」から取り直す（クロージャ古値防止）
    let origStart = 0;
    let origEnd = 0;
    setAssignments((prev) => {
      const tgt = prev[targetIdx];
      if (tgt) {
        origStart = timeToSlot(tgt.startTime);
        origEnd = timeToSlot(tgt.endTime);
      }
      return prev;
    });
    const draftEl = e.currentTarget as HTMLElement;
    draftEl.classList.add('dragging');
    try {
      (draftEl as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* 一部ブラウザで失敗しても無視 */
    }

    let moved = false;

    function onMove(ev: PointerEvent) {
      moved = true;
      const dx = ev.clientX - startX;
      const dSlot = Math.round(dx / slotPx);
      let s = origStart;
      let en = origEnd;
      const dur = origEnd - origStart;
      if (mode === 'move') {
        s = origStart + dSlot;
        en = origEnd + dSlot;
        // 枠外調整
        if (s < 0) {
          en = dur;
          s = 0;
        }
        if (en > SLOTS) {
          s = SLOTS - dur;
          en = SLOTS;
        }
      } else if (mode === 'lh') {
        s = Math.min(origEnd - 1, Math.max(0, origStart + dSlot));
        en = origEnd;
      } else if (mode === 'rh') {
        s = origStart;
        en = Math.max(origStart + 1, Math.min(SLOTS, origEnd + dSlot));
      }
      // インデックス基準で更新（参照比較バグ対策）
      setAssignments((prev) => {
        if (targetIdx < 0 || targetIdx >= prev.length) return prev;
        const next = prev.slice();
        next[targetIdx] = {
          ...prev[targetIdx],
          startTime: slotToTime(s),
          endTime: slotToTime(en),
        };
        return next;
      });
    }
    function onUp() {
      draftEl.classList.remove('dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // 何も動かなかった場合は何もしない（クリックイベントは伝わらないので問題なし）
      void moved;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ====== Sprint O/Q/R: 表示用に分類（プール / フィルタ） ======
  // Sprint Q: forceAssignableSet に入れた休み社員は「出勤扱い」で扱う（ヘルプ要員等）
  const isWorking = (s: StaffShift) =>
    !s.isOff || forceAssignableSet.has(s.staffCode);

  // Sprint R: シフト外ヘルプ要員を todayShifts と合体（重複は外側のもの優先）
  const mergedShifts: StaffShift[] = [
    ...todayShifts,
    ...externalHelpers.filter(
      (e) => !todayShifts.some((s) => s.staffCode === e.staffCode),
    ),
  ];

  const unsetPool = mergedShifts.filter(
    (s) => isWorking(s) && !assignments.some((a) => a.staffCode === s.staffCode),
  );
  const offPool = mergedShifts.filter(
    (s) => s.isOff && !forceAssignableSet.has(s.staffCode),
  );

  const visibleStaff = mergedShifts.filter((s) => {
    // 既定は出勤予定者のみ表示。休みは別プールに表示するためチャートから除外。
    if (filterMode === 'working') return isWorking(s);
    if (filterMode === 'all') return true;
    if (filterMode === 'unset')
      return isWorking(s) && !assignments.some((a) => a.staffCode === s.staffCode);
    if (filterMode === 'off')
      return s.isOff && !forceAssignableSet.has(s.staffCode);
    if (filterMode === 'assigned')
      return isWorking(s) && assignments.some((a) => a.staffCode === s.staffCode);
    return true;
  });

  // Sprint R: ヘルプピッカー候補 = staff master のうち、シフト未登録 + ヘルプ未追加
  const helperCandidates = allStaff.filter((m) => {
    if (!m.assignable) return false;
    if (todayShifts.some((s) => s.staffCode === m.code)) return false;
    if (externalHelpers.some((e) => e.staffCode === m.code)) return false;
    if (!helperFilterText) return true;
    const q = helperFilterText.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.empCode.toLowerCase().includes(q) ||
      m.code.toLowerCase().includes(q) ||
      (m.groupId ?? '').toLowerCase().includes(q)
    );
  });

  function addHelper(staff: typeof allStaff[number]) {
    const entry: StaffShift = {
      staffCode: staff.code,
      staffName: staff.name,
      patternCode: 'HELP',
      startTime: '09:00',
      endTime: '17:00',
      defaultGroupId: staff.groupId,
      isOff: false,
    };
    setExternalHelpers((prev) => [...prev, entry]);
    setHelperPickerOpen(false);
    setHelperFilterText('');
  }

  /**
   * 当日欠勤に切替（2026-05-20 追加）
   *  - サーバ側でシフトを欠勤パターンに更新、当日の割当を削除
   *  - ローカル状態も即時更新（再 loadAll はサーバ反映後）
   */
  async function markAbsent(staff: StaffShift) {
    if (
      !confirm(
        `${staff.staffName} さんを「欠勤」に切替えますか？\n\n` +
          `・対象日: ${date}\n` +
          `・割当済の時間帯は削除されます\n` +
          `・休みメンバープールに移動します`,
      )
    )
      return;
    const reason = prompt('欠勤理由（任意）', '');
    setBusy(true);
    try {
      const r = await fetch('/api/shifts/mark-absent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          staffCode: staff.staffCode,
          reason: reason ?? undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j?.message ?? `エラー: HTTP ${r.status}`);
        return;
      }
      setStatusMsg(`✓ ${staff.staffName} を欠勤に切替えました`);
      setTimeout(() => setStatusMsg(null), 3000);
      // サーバから再読み込みでシフト・割当ともに最新化
      await loadAll();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  function removeHelper(staffCode: string) {
    setExternalHelpers((prev) => prev.filter((e) => e.staffCode !== staffCode));
    // 関連する割当も自動削除
    setAssignments((prev) => prev.filter((a) => a.staffCode !== staffCode));
  }

  // モック準拠: 1 時間 = 9 列のうち 1 列。横軸 9-18時 (9 時間 = 18 スロット)
  const HOURS_COUNT = HOURS_TO - HOURS_FROM; // = 9
  // 強調する縦線（昼休憩・夕方締切相当）
  const STRONG_HOURS = [12, 15, 16];

  return (
    <div className={cn('space-y-2', light && 'assignment-light')}>
      {/* ヒント (モック L4792-4794) */}
      <div className="bg-blue-950/40 border border-blue-700/40 rounded text-xs text-blue-100 px-2.5 py-1.5 leading-snug">
        💡 時間帯バーを<b>ドラッグで移動</b>（30分単位スナップ）／右端 × で削除／
        <b>メンバー名をクリック</b>で割当追加／先頭行の時間ヘッダーは固定表示
      </div>

      {/* ツールバー（モック L4795-4809） */}
      <div className="bg-surface-panel border border-surface-border rounded p-2 flex flex-wrap items-center gap-2">
        <span className="text-2xs text-ink-subtle">対象日:</span>
        <TextInput
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="!w-auto text-xs"
        />
        <span className="text-2xs text-ink-subtle ml-2">表示:</span>
        <select
          value={filterMode}
          onChange={(e) => setFilterMode(e.target.value as FilterMode)}
          className="bg-surface-base border border-surface-border-strong rounded px-2 py-1 text-2xs text-ink"
        >
          <option value="working">出勤予定のみ</option>
          <option value="all">全メンバー（休み含む）</option>
          <option value="unset">未設定のみ</option>
          <option value="off">休みのみ</option>
          <option value="assigned">割当済のみ</option>
        </select>
        <span className="text-2xs text-ink-subtle ml-2">プリセット:</span>
        <button
          type="button"
          onClick={onLoadYesterday}
          disabled={busy}
          className="bg-surface-base border border-surface-border-strong text-ink hover:text-accent-amber rounded px-2 py-1 text-2xs disabled:opacity-50"
        >
          昨日と同じ
        </button>
        <button
          type="button"
          onClick={onApplyShifts}
          disabled={busy}
          className="bg-surface-base border border-surface-border-strong text-ink hover:text-accent-amber rounded px-2 py-1 text-2xs disabled:opacity-50"
        >
          段階目標から自動算出
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="bg-surface-base border border-surface-border-strong text-ink hover:text-status-error rounded px-2 py-1 text-2xs disabled:opacity-50"
        >
          全クリア
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => window.print()}
          className="bg-surface-base border border-surface-border-strong text-ink hover:text-accent-amber rounded px-2 py-1 text-2xs"
        >
          🖨 印刷
        </button>
      </div>

      {/* 凡例（モック L4811-4822 — グループ色見本） */}
      <div className="flex flex-wrap gap-2 text-3xs text-ink-subtle px-1">
        {groups.map((g) => {
          const c = groupColorRgb(g.id);
          return (
            <div key={g.id} className="flex items-center gap-1">
              <span
                className="inline-block w-3.5 h-2.5 rounded-sm"
                style={{ background: c.bg }}
              />
              <span>{g.name}</span>
            </div>
          );
        })}
      </div>

      {statusMsg && (
        <div className="text-xs text-ink bg-status-info-bg border border-status-info/40 rounded p-2">
          {statusMsg}
        </div>
      )}

      {/* Gantt 本体（モック L4824-4826 / .sa-gantt） */}
      <div className="bg-slate-900 border border-surface-border rounded p-1.5 overflow-auto max-h-[500px]">
        {/* グリッド = 担当者 110px + 9 時間カラム */}
        <div
          className="grid bg-slate-950 gap-px"
          style={{
            gridTemplateColumns: `110px repeat(${HOURS_COUNT}, minmax(60px, 1fr))`,
          }}
        >
          {/* ヘッダ：時間／担当 + 9 時間ラベル */}
          <div className="sticky top-0 z-30 bg-slate-800 text-ink-subtle text-3xs px-2 py-1 text-center font-bold border-b border-slate-700">
            時間／担当
          </div>
          {Array.from({ length: HOURS_COUNT }).map((_, i) => {
            const h = HOURS_FROM + i;
            const isStrong = STRONG_HOURS.includes(h);
            return (
              <div
                key={h}
                className={cn(
                  'sticky top-0 z-20 text-center text-3xs px-1 py-1 font-mono font-bold border-b border-slate-700',
                  isStrong ? 'bg-amber-950/50 text-accent-amber' : 'bg-slate-800 text-ink-subtle',
                )}
              >
                {h}:00
              </div>
            );
          })}

          {/* 各メンバー行 */}
          {visibleStaff.length === 0 && (
            <div
              className="text-center text-ink-muted py-8 text-sm bg-slate-950"
              style={{ gridColumn: `span ${HOURS_COUNT + 1}` }}
            >
              {todayShifts.length === 0
                ? '当日シフトがありません（先に /shift で取込んでください）'
                : 'フィルタに該当するメンバーがいません'}
            </div>
          )}
          {visibleStaff.map((s) => {
            // インデックス付きで自分のバーを抽出（startBarPointer に元配列の index を渡すため）
            const myBars = assignments
              .map((a, idx) => ({ a, idx }))
              .filter((x) => x.a.staffCode === s.staffCode);
            const isOff = s.isOff;
            return (
              <RowItem
                key={s.staffCode}
                staff={s}
                isOff={isOff}
                myBars={myBars}
                hoursCount={HOURS_COUNT}
                strongHours={STRONG_HOURS}
                hoursFrom={HOURS_FROM}
                groups={groups}
                groupColorRgb={groupColorRgb}
                timeToSlot={timeToSlot}
                slotsTotal={SLOTS}
                onClickName={() => openPicker(s)}
                onBarDown={startBarPointer}
                onBarDelete={(idx) => deleteBar(idx)}
                onBarDoubleClick={(idx) => editAssignment(idx)}
              />
            );
          })}
        </div>
      </div>

      {/* プール（モック L4828-4837 / .sa-pools — Gantt の下に配置） */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 print:hidden">
        <div
          className="rounded p-2 border"
          style={{ background: '#1a1409', borderColor: '#f59e0b' }}
        >
          <div className="text-2xs font-bold mb-1.5 flex justify-between items-center" style={{ color: '#fed7aa' }}>
            <span>🚶 未設定メンバー（{unsetPool.length}名）</span>
            <button
              type="button"
              onClick={() => setHelperPickerOpen(true)}
              className="px-2 py-0.5 rounded text-2xs font-bold transition-colors"
              style={{
                background: '#1e40af',
                color: '#ffffff',
                border: '1px solid #3b82f6',
              }}
              title="シフト外（他部署ヘルプ・短期バイト等）を担当者マスタから選んで追加"
            >
              ＋ シフト外ヘルプ追加
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {unsetPool.length === 0 && (
              <span className="text-3xs text-ink-muted">（なし）</span>
            )}
            {unsetPool.map((s) => {
              const isHelper = externalHelpers.some((e) => e.staffCode === s.staffCode);
              return (
                <span
                  key={s.staffCode}
                  className="inline-flex items-center gap-0.5 rounded text-2xs select-none overflow-hidden"
                  style={{
                    background: isHelper ? '#1e3a8a' : '#7c2d12',
                    color: isHelper ? '#bfdbfe' : '#fed7aa',
                    border: `1px solid ${isHelper ? '#3b82f6' : '#f59e0b'}`,
                  }}
                  title={
                    isHelper
                      ? `シフト外ヘルプ要員 — クリックで割当`
                      : `クリックで割当 — シフト ${s.startTime ?? ''}-${s.endTime ?? ''}`
                  }
                >
                  {isHelper && (
                    <span className="px-1 text-[9px] font-bold opacity-80">＋</span>
                  )}
                  <button
                    type="button"
                    onClick={() => openPicker(s)}
                    className="px-2 py-0.5 hover:brightness-110 transition-all"
                  >
                    {s.staffName}
                  </button>
                  {/* 2026-05-20: 当日欠勤に切替えるアイコンボタン（ヘルプ要員以外に表示） */}
                  {!isHelper && (
                    <button
                      type="button"
                      onClick={() => markAbsent(s)}
                      className="px-1 hover:bg-red-700/60 text-red-200"
                      style={{ fontSize: 11 }}
                      title="当日欠勤に切替（休みメンバーへ移動）"
                    >
                      💤
                    </button>
                  )}
                  {isHelper && (
                    <button
                      type="button"
                      onClick={() => removeHelper(s.staffCode)}
                      className="px-1 hover:bg-red-700/40"
                      style={{ fontSize: 12 }}
                      title="ヘルプ要員を解除"
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        </div>
        <div className="rounded p-2 border bg-slate-950 border-slate-600">
          <div className="text-2xs font-bold text-slate-300 mb-1.5 flex justify-between items-center">
            <span>💤 休みメンバー</span>
            <span className="text-3xs text-ink-muted font-normal">
              ⤴ アイコン = ヘルプ出勤に切替（{offPool.length}名）
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {offPool.length === 0 && (
              <span className="text-3xs text-ink-muted">（なし）</span>
            )}
            {offPool.map((s) => (
              <span
                key={s.staffCode}
                className="inline-flex items-center gap-0.5 rounded text-2xs select-none overflow-hidden"
                style={{
                  background: '#1e293b',
                  border: '1px solid #475569',
                }}
                title={`${s.staffName} (${s.patternCode})`}
              >
                <span
                  className="px-2 py-0.5 line-through"
                  style={{ color: '#94a3b8' }}
                >
                  {s.staffName}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        `${s.staffName} さん（${s.patternCode}）をヘルプ要員として出勤予定プールに移動しますか？\n移動後は割当ピッカーで配置可能になります。`,
                      )
                    ) {
                      setForceAssignableSet((prev) =>
                        new Set(prev).add(s.staffCode),
                      );
                    }
                  }}
                  className="px-1 hover:bg-amber-700/40"
                  style={{ color: '#fbbf24', fontSize: 12 }}
                  title="ヘルプ出勤に切替"
                >
                  ⤴
                </button>
              </span>
            ))}
          </div>
          {forceAssignableSet.size > 0 && (
            <div className="mt-1.5 text-3xs text-amber-200 flex items-center gap-1">
              <span>⚠ ヘルプ出勤中:</span>
              {Array.from(forceAssignableSet).map((code) => {
                const s = todayShifts.find((x) => x.staffCode === code);
                return (
                  <span
                    key={code}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700"
                  >
                    {s?.staffName ?? code}
                    <button
                      type="button"
                      onClick={() => {
                        setForceAssignableSet((prev) => {
                          const next = new Set(prev);
                          next.delete(code);
                          return next;
                        });
                      }}
                      className="text-amber-200 hover:text-status-error font-bold ml-0.5"
                      title="休みに戻す"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 保存バー */}
      <div className="flex justify-end gap-2 print:hidden">
        <Button onClick={onSave} disabled={busy} size="sm">
          {busy ? '…' : '✓ この割当で保存'}
        </Button>
      </div>

      <p className="text-2xs text-ink-muted print:hidden">
        💡 操作:
        <b className="text-accent-amber"> 担当者名 / プールチップをクリック</b> で新規追加 ／
        バー<b>ダブルクリック</b>で編集 ／ バー中央ドラッグで<b>移動</b> ／ 両端 (左右 6px) で<b>リサイズ</b> ／ × ボタンで削除。
        全て 30 分単位でスナップします。休みメンバー (💤) は割当不可です。
      </p>

      {/* Sprint R: シフト外ヘルプ追加 ピッカー */}
      {helperPickerOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setHelperPickerOpen(false);
              setHelperFilterText('');
            }
          }}
        >
          <div className="bg-surface-panel border-2 border-accent-amber rounded-[10px] shadow-modal w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-4 py-3 border-b border-surface-border bg-blue-950/30">
              <h4 className="text-base font-bold text-accent-amber">
                ＋ シフト外ヘルプ要員を追加
              </h4>
              <p className="text-3xs text-ink-subtle mt-1 leading-snug">
                他部署からのヘルプ・短期バイト等、本日のシフトに登録されていない担当者を一時的にプールへ追加します。
                追加後は通常通り「クリック → 割当」で配置できます。
              </p>
            </div>
            <div className="px-4 pt-3">
              <input
                type="text"
                value={helperFilterText}
                onChange={(e) => setHelperFilterText(e.target.value)}
                placeholder="🔍 氏名 / 従業員番号 / コード / グループで検索"
                className="w-full bg-surface-base border border-surface-border-strong rounded px-2 py-1.5 text-xs text-ink"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-auto px-2 py-2">
              {helperCandidates.length === 0 ? (
                <div className="text-center text-2xs text-ink-muted py-6">
                  {helperFilterText
                    ? '該当する担当者がいません'
                    : 'シフト未登録の担当者はいません'}
                </div>
              ) : (
                <div className="border border-surface-border rounded overflow-hidden">
                  <table className="w-full text-2xs">
                    <thead className="bg-surface-base border-b border-surface-border">
                      <tr>
                        <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">コード</th>
                        <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">従業員#</th>
                        <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">氏名</th>
                        <th className="px-2 py-1 text-left text-3xs uppercase text-ink-subtle">所属</th>
                        <th className="px-2 py-1 text-right text-3xs uppercase text-ink-subtle">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {helperCandidates.map((m) => (
                        <tr key={m.code} className="border-t border-surface-border hover:bg-blue-950/30">
                          <td className="px-2 py-1 font-mono text-3xs text-ink-muted">{m.code}</td>
                          <td className="px-2 py-1 font-mono text-3xs">{m.empCode}</td>
                          <td className="px-2 py-1 font-bold text-ink-strong">{m.name}</td>
                          <td className="px-2 py-1 text-3xs text-ink-subtle">
                            {m.groupId ?? '—'}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <button
                              type="button"
                              onClick={() => addHelper(m)}
                              className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-3xs font-bold border border-emerald-500"
                            >
                              ＋ 追加
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-surface-border flex justify-between items-center bg-surface-base">
              <span className="text-3xs text-ink-muted">
                {helperCandidates.length} 名 / 全担当者 {allStaff.length} 名
              </span>
              <button
                onClick={() => {
                  setHelperPickerOpen(false);
                  setHelperFilterText('');
                }}
                className="px-3 py-1.5 rounded border border-surface-border bg-surface-base text-xs text-ink"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sprint O-1: 割当ピッカー モーダル（モック L4847-4899 準拠） */}
      {picker && (
        <div
          className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPicker(null);
          }}
        >
          <div className="bg-surface-panel border-2 border-accent-amber rounded-[10px] shadow-modal w-full max-w-md overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-border bg-blue-950/30">
              <h4 className="text-base font-bold text-accent-amber">
                {picker.staffName} さんの割当を
                {picker.editIndex !== undefined ? '編集' : '追加'}
              </h4>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                <label className="text-2xs text-ink-subtle">グループ</label>
                <select
                  value={picker.groupId}
                  onChange={(e) =>
                    setPicker({ ...picker, groupId: e.target.value })
                  }
                  className="bg-surface-base border border-surface-border-strong rounded px-2 py-1.5 text-xs text-ink"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                <label className="text-2xs text-ink-subtle">開始</label>
                <select
                  value={picker.startTime}
                  onChange={(e) =>
                    setPicker({ ...picker, startTime: e.target.value })
                  }
                  className="bg-surface-base border border-surface-border-strong rounded px-2 py-1.5 text-xs text-ink font-mono"
                >
                  {Array.from({ length: SLOTS }).map((_, i) => (
                    <option key={i} value={slotToTime(i)}>
                      {slotToTime(i)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                <label className="text-2xs text-ink-subtle">終了</label>
                <select
                  value={picker.endTime}
                  onChange={(e) =>
                    setPicker({ ...picker, endTime: e.target.value })
                  }
                  className="bg-surface-base border border-surface-border-strong rounded px-2 py-1.5 text-xs text-ink font-mono"
                >
                  {Array.from({ length: SLOTS + 1 }).map((_, i) => (
                    <option key={i} value={slotToTime(i)}>
                      {slotToTime(i)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-4 py-2.5 border-t border-surface-border flex justify-between gap-2 bg-surface-base">
              {/* 2026-05-20: 欠勤切替（このメンバーを当日休みに） */}
              <button
                onClick={() => {
                  const targetStaff = todayShifts.find(
                    (s) => s.staffCode === picker.staffCode,
                  ) ?? {
                    staffCode: picker.staffCode,
                    staffName: picker.staffName,
                    patternCode: 'HELP',
                    startTime: null,
                    endTime: null,
                    defaultGroupId: null,
                    isOff: false,
                  };
                  setPicker(null);
                  markAbsent(targetStaff);
                }}
                className="px-3 py-1.5 rounded border border-red-500/50 bg-red-950/40 text-red-200 text-xs hover:bg-red-900/60"
                title="このメンバーを当日欠勤に切替（休みメンバープールへ）"
              >
                💤 当日欠勤
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setPicker(null)}
                  className="px-3 py-1.5 rounded border border-surface-border bg-surface-base text-xs text-ink"
                >
                  キャンセル
                </button>
                <button
                  onClick={pickerSubmit}
                  className="px-4 py-1.5 rounded bg-blue-700 hover:bg-blue-600 border border-blue-400 text-xs font-bold text-white"
                >
                  {picker.editIndex !== undefined ? '更新' : '追加'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * RowItem — メンバー 1 行（担当者名 + 9 時間カラムにまたがる strip）
 * モック L760-826 / L6157-6177 準拠。
 * - 担当者列(110px) は sticky/cursor:pointer
 * - strip は grid-column: 2 / span 9 で 9 列にまたがる relative 領域
 * - 内部に 30 分ティック + シフト時間ハイライト + 割当バー
 * ============================================================ */
function RowItem({
  staff,
  isOff,
  myBars,
  hoursCount,
  strongHours,
  hoursFrom,
  groups,
  groupColorRgb,
  timeToSlot,
  slotsTotal,
  onClickName,
  onBarDown,
  onBarDelete,
  onBarDoubleClick,
}: {
  staff: StaffShift;
  isOff: boolean;
  /** 自分のバー一覧（元 assignments 配列でのインデックス付き） */
  myBars: { a: Assignment; idx: number }[];
  hoursCount: number;
  strongHours: number[];
  hoursFrom: number;
  groups: Group[];
  groupColorRgb: (id: string) => { bg: string; fg: string };
  timeToSlot: (t: string) => number;
  slotsTotal: number;
  onClickName: () => void;
  onBarDown: (
    e: React.PointerEvent<HTMLElement>,
    targetIdx: number,
    mode: 'move' | 'lh' | 'rh',
  ) => void;
  onBarDelete: (targetIdx: number) => void;
  /** バー本体をダブルクリックで編集起動（2026-05-18 追加） */
  onBarDoubleClick: (targetIdx: number) => void;
}) {
  return (
    <>
      {/* 担当者名（モック .sn） */}
      <button
        type="button"
        onClick={onClickName}
        disabled={isOff}
        className={cn(
          'sticky left-0 z-10 px-2 py-1 text-left border-r border-slate-700',
          'flex flex-col justify-center',
          isOff
            ? 'bg-red-950 text-red-200 cursor-not-allowed'
            : 'bg-slate-800 text-ink-strong hover:bg-slate-700 cursor-pointer',
        )}
        style={{ minHeight: 32 }}
        title={isOff ? '休み（割当不可）' : 'クリックで割当を追加'}
      >
        <div className="text-2xs font-bold truncate leading-tight">
          {staff.staffName}
          {isOff && <span className="ml-1 text-3xs">💤</span>}
        </div>
      </button>

      {/* strip（9 時間カラムにまたがる relative） */}
      <div
        data-track
        className="relative bg-slate-950 border-b border-slate-800"
        style={{
          gridColumn: `2 / span ${hoursCount}`,
          minHeight: 32,
        }}
      >
        {/* 30 分グリッド（モック L6159-6164） */}
        {Array.from({ length: hoursCount * 2 }).map((_, i) => {
          const h = hoursFrom + i / 2;
          const left = (i / (hoursCount * 2)) * 100;
          const isHourLine = i % 2 === 0;
          const isStrong = isHourLine && strongHours.includes(h);
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0"
              style={{
                left: `${left}%`,
                width: '1px',
                background: isStrong ? '#475569' : isHourLine ? '#334155' : '#1e293b',
              }}
            />
          );
        })}

        {/* シフト時間帯のハイライト（出勤予定の時間） */}
        {!isOff && staff.startTime && staff.endTime && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `${(timeToSlot(staff.startTime) / slotsTotal) * 100}%`,
              width: `${
                ((timeToSlot(staff.endTime) - timeToSlot(staff.startTime)) /
                  slotsTotal) *
                100
              }%`,
              background: 'rgba(30, 64, 175, 0.18)',
            }}
          />
        )}

        {/* 割当バー（モック .seg）— Sprint Q: key を idx に固定して再マウント回避 */}
        {myBars.map(({ a, idx }) => {
          const startSlot = timeToSlot(a.startTime);
          const endSlot = timeToSlot(a.endTime);
          const left = (startSlot / slotsTotal) * 100;
          const width = ((endSlot - startSlot) / slotsTotal) * 100;
          const grp = groups.find((g) => g.id === a.groupId);
          const c = groupColorRgb(a.groupId);
          return (
            <div
              key={`bar-${idx}`}
              onPointerDown={(e) => onBarDown(e, idx, 'move')}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onBarDoubleClick(idx);
              }}
              className="absolute rounded shadow-md flex items-center justify-center select-none cursor-move font-bold overflow-hidden"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: 3,
                bottom: 3,
                background: c.bg,
                color: c.fg,
                fontSize: 10,
                touchAction: 'none', // モバイル用 — gesture 干渉防止
              }}
              title={`${grp?.name ?? a.groupId} ${a.startTime}-${a.endTime}（中央ドラッグ=移動／両端=時間調整／ダブルクリック=編集）`}
            >
              {/* 左端ハンドル */}
              <div
                onPointerDown={(e) => onBarDown(e, idx, 'lh')}
                className="absolute left-0 top-0 bottom-0 cursor-ew-resize hover:bg-black/40"
                style={{ width: 8, touchAction: 'none' }}
                title="開始時刻を変更"
              />
              {/* バーラベル "ABL 9:00-12:00" */}
              <span className="px-1 truncate pointer-events-none">
                {grp?.name ?? a.groupId} {a.startTime}-{a.endTime}
              </span>
              {/* × 削除 */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onBarDelete(idx);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute top-0.5 right-0.5 leading-3 rounded bg-black/40 hover:bg-status-error font-bold"
                style={{ width: 14, height: 14, fontSize: 10, color: '#fff' }}
                title="削除"
              >
                ×
              </button>
              {/* 右端ハンドル */}
              <div
                onPointerDown={(e) => onBarDown(e, idx, 'rh')}
                className="absolute right-0 top-0 bottom-0 cursor-ew-resize hover:bg-black/40"
                style={{ width: 8, touchAction: 'none' }}
                title="終了時刻を変更"
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
