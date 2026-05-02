/**
 * GET /api/shifts/today
 * 当日のシフト（メンバー割当ガントの初期化用）
 *
 * 出勤者（is_off=false の pattern）のみ返す。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items = await prisma.shift.findMany({
    where: {
      date: today,
      pattern: { isOff: false },
    },
    include: {
      staff: { select: { code: true, name: true, kana: true, groupId: true, defaultShiftPattern: true } },
      pattern: { select: { code: true, name: true, startTime: true, endTime: true } },
    },
    orderBy: { staffCode: 'asc' },
  });

  return NextResponse.json({ data: { items }, message: 'OK' });
}
