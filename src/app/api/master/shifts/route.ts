/**
 * GET  /api/master/shifts   一覧（既定 = 直近 7 日）
 * POST /api/master/shifts   作成（同一 (date, staffCode) は upsert）
 *
 * 720 行規模のため, 日付フィルタ前提の API。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffCode: z.string().min(1).max(10),
  patternCode: z.string().min(1).max(10),
  startTime: z.string().max(5).nullable().optional(),
  endTime: z.string().max(5).nullable().optional(),
  source: z.enum(['manual', 'gp_csv', 'auto']).default('manual'),
  note: z.string().nullable().optional(),
});

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get('from');
  const toStr = searchParams.get('to');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = fromStr ? new Date(fromStr) : today;
  const to = toStr
    ? new Date(toStr)
    : (() => {
        const d = new Date(today);
        d.setDate(d.getDate() + 7);
        return d;
      })();

  const items = await prisma.shift.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: [{ date: 'asc' }, { staffCode: 'asc' }],
    include: { staff: { select: { name: true } } },
  });

  return NextResponse.json({
    data: {
      items: items.map((s) => ({
        id: s.id,
        date: s.date.toISOString().slice(0, 10),
        staffCode: s.staffCode,
        staffName: s.staff?.name ?? null,
        patternCode: s.patternCode,
        startTime: s.startTime,
        endTime: s.endTime,
        source: s.source,
        note: s.note,
      })),
    },
    message: 'OK',
  });
}

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
  const { date, staffCode, patternCode, startTime, endTime, source, note } = parsed.data;
  try {
    // 同日同担当者は upsert（既存があれば更新）
    const created = await prisma.shift.upsert({
      where: { date_staffCode: { date: new Date(date), staffCode } },
      create: {
        date: new Date(date),
        staffCode,
        patternCode,
        startTime: startTime ?? null,
        endTime: endTime ?? null,
        source,
        note: note ?? null,
      },
      update: {
        patternCode,
        startTime: startTime ?? null,
        endTime: endTime ?? null,
        source,
        note: note ?? null,
      },
    });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/shifts]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（パターンコード未登録の可能性）',
    );
  }
}
