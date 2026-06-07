/**
 * POST /api/assignments/init-from-shift
 * 当日のシフトをガント割当のベース状態に反映する（Sprint M-2）。
 *
 * 動作:
 *  - 当日の既存割当をすべて削除
 *  - 出勤予定者は未設定プール（割当なし状態）として扱われる
 *    （AssignmentClient 側が /api/shifts/today から自動的にプールへ表示）
 *
 * リクエスト:
 *   { date: 'YYYY-MM-DD' }（省略時は今日）
 *
 * 応答:
 *   { workCount, offCount, clearedAssignments }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC, todayJstAsUTC, formatDateYmd } from '@/lib/date-utils';

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  // 2026-05-20: JST 環境での 1 日ずれを避けるため UTC 真夜中で扱う
  const target = parsed.data.date ? parseDateAsUTC(parsed.data.date) : todayJstAsUTC();
  if (!target) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${parsed.data.date}` },
      { status: 422 },
    );
  }

  // 当日のシフト件数を集計（出勤 / 休み）
  const shifts = await prisma.shift.findMany({
    where: { date: target },
    include: { pattern: { select: { isOff: true } } },
  });
  const workCount = shifts.filter((s) => !s.pattern.isOff).length;
  const offCount = shifts.length - workCount;

  if (shifts.length === 0) {
    return NextResponse.json(
      {
        error: 'NOT_FOUND',
        message: `${formatDateYmd(target)} のシフトが登録されていません`,
      },
      { status: 404 },
    );
  }

  // 既存割当をクリア（プール状態にリセット）
  const cleared = await prisma.memberAssignment.deleteMany({
    where: { date: target },
  });

  return NextResponse.json({
    data: {
      date: formatDateYmd(target),
      workCount,
      offCount,
      clearedAssignments: cleared.count,
    },
    message: 'OK',
  });
}
