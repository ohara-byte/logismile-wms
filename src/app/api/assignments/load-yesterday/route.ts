/**
 * POST /api/assignments/load-yesterday
 * 昨日の割当を当日に複製
 *
 * リクエスト: { date: 'YYYY-MM-DD' }（複製先 = 当日想定）
 *  - 複製元 = date - 1 日
 *  - 既存の当日割当は削除してから複製
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC, addDaysUTC, formatDateYmd } from '@/lib/date-utils';

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }
  // 2026-05-20: JST 環境での 1 日ずれを避けるため UTC 真夜中で扱う
  const target = parseDateAsUTC(parsed.data.date);
  if (!target) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${parsed.data.date}` },
      { status: 422 },
    );
  }
  const yesterday = addDaysUTC(target, -1);

  const previous = await prisma.memberAssignment.findMany({
    where: { date: yesterday },
    select: { staffCode: true, groupId: true, startTime: true, endTime: true },
  });

  await prisma.$transaction([
    prisma.memberAssignment.deleteMany({ where: { date: target } }),
    ...(previous.length > 0
      ? [
          prisma.memberAssignment.createMany({
            data: previous.map((p) => ({
              ...p,
              date: target,
              createdBy: guard.auth.staffCode ?? null,
            })),
          }),
        ]
      : []),
  ]);

  return NextResponse.json({
    data: { copied: previous.length, from: formatDateYmd(yesterday) },
    message: 'OK',
  });
}
