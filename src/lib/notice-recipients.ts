/**
 * 連絡事項の受信者解決（サーバ専用・Prisma 利用）
 *
 * 2026-08-09 新規。判定ロジック本体は `notice-target.ts`（純関数）にあり、
 * ここは「DB から判定材料を集める」役割だけを持つ。
 *
 * グループの決め方（★ 小原様確定 2026-08-09）:
 *   当日の割当ガント（member_assignments）を正とする。
 *   割当が未入力の日は担当者マスタの所属（staff.group_id）で補完する。
 *   ―― 割当を入れ忘れた日に連絡が誰にも届かなくなるのを避けるため。
 */

import { prisma } from '@/lib/db';
import { todayJstAsUTC } from '@/lib/date-utils';
import { normalizeTableLetter, type RecipientCtx } from '@/lib/notice-target';

/**
 * 指定グループ群が受け持つ作業テーブル記号を集める（大文字・重複排除）。
 */
async function tableLettersOfGroups(groupIds: string[]): Promise<string[]> {
  if (groupIds.length === 0) return [];
  const groups = await prisma.inspectionGroup.findMany({
    where: { id: { in: groupIds } },
    select: { tables: true },
  });
  const set = new Set<string>();
  for (const g of groups) {
    for (const t of g.tables) {
      const code = normalizeTableLetter(t);
      if (code) set.add(code);
    }
  }
  return Array.from(set);
}

/**
 * 端末＋ログイン中の担当者から、宛先判定に必要な文脈を組み立てる。
 *
 * @param deviceCode devices.code（セッションの端末コード）
 * @param staffCode  ログイン中の社員コード
 * @param date       判定基準日（既定＝今日 JST）
 */
export async function resolveRecipientCtx(
  deviceCode: string | null,
  staffCode: string | null,
  date: Date = todayJstAsUTC(),
): Promise<RecipientCtx> {
  const [device, assignments, staff] = await Promise.all([
    deviceCode
      ? prisma.device.findUnique({
          where: { code: deviceCode },
          select: { type: true },
        })
      : Promise.resolve(null),
    staffCode
      ? prisma.memberAssignment.findMany({
          where: { date, staffCode },
          select: { groupId: true },
        })
      : Promise.resolve([]),
    staffCode
      ? prisma.staff.findUnique({
          where: { code: staffCode },
          select: { groupId: true },
        })
      : Promise.resolve(null),
  ]);

  // 当日割当を優先。未入力の日は担当者マスタの所属で補完。
  let groupIds = Array.from(new Set(assignments.map((a) => a.groupId)));
  if (groupIds.length === 0 && staff?.groupId) groupIds = [staff.groupId];

  return {
    deviceType: device?.type ?? null,
    staffCode,
    groupIds,
    tableLetters: await tableLettersOfGroups(groupIds),
  };
}

export interface TableRecipient {
  /** テーブル記号（A〜Z） */
  code: string;
  groupId: string;
  groupName: string;
  /** 当日そのグループに配置されている担当者 */
  staff: {
    code: string;
    name: string;
    startTime: string;
    endTime: string;
  }[];
}

/**
 * 管理 PC の宛先ピッカー用。作業テーブル一覧と、各テーブルの当日担当者を返す。
 *
 * テーブル記号が複数グループに現れる場合は先勝ち（`api/master/tables` と同じ扱い）。
 */
export async function listTableRecipients(date: Date): Promise<TableRecipient[]> {
  const groups = await prisma.inspectionGroup.findMany({
    select: { id: true, name: true, tables: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });

  const assignments = await prisma.memberAssignment.findMany({
    where: { date },
    orderBy: [{ startTime: 'asc' }],
    select: {
      groupId: true,
      startTime: true,
      endTime: true,
      staff: { select: { code: true, name: true, active: true } },
    },
  });

  // グループ ID → 当日担当者（退職者は除外・同一人物の重複は最初の 1 件）
  const staffByGroup = new Map<string, TableRecipient['staff']>();
  for (const a of assignments) {
    if (!a.staff.active) continue;
    const list = staffByGroup.get(a.groupId) ?? [];
    if (list.some((s) => s.code === a.staff.code)) continue;
    list.push({
      code: a.staff.code,
      name: a.staff.name,
      startTime: a.startTime,
      endTime: a.endTime,
    });
    staffByGroup.set(a.groupId, list);
  }

  const seen = new Set<string>();
  const out: TableRecipient[] = [];
  for (const g of groups) {
    for (const t of g.tables) {
      const code = normalizeTableLetter(t);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push({
        code,
        groupId: g.id,
        groupName: g.name,
        staff: staffByGroup.get(g.id) ?? [],
      });
    }
  }
  out.sort((a, b) => a.code.localeCompare(b.code));
  return out;
}
