/**
 * GET /api/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD&staffCode=
 * POST /api/shifts                — 個別登録（手動）
 *
 * 一覧は staff JOIN したオブジェクトを返す（マトリクス表示用）。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const staffCode = searchParams.get('staffCode');
  if (!from || !to) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'from / to は必須です（YYYY-MM-DD）' },
      { status: 422 },
    );
  }

  const items = await prisma.shift.findMany({
    where: {
      date: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999Z`) },
      ...(staffCode ? { staffCode } : {}),
    },
    include: {
      staff: { select: { code: true, name: true, kana: true, employmentTypeCode: true, groupId: true } },
      pattern: { select: { code: true, name: true, isOff: true, startTime: true, endTime: true } },
    },
    orderBy: [{ date: 'asc' }, { staffCode: 'asc' }],
  });

  return NextResponse.json({ data: { items }, message: 'OK' });
}

const PostBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffCode: z.string().min(1),
  patternCode: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  note: z.string().optional(),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const data = parsed.data;
  const upserted = await prisma.shift.upsert({
    where: { date_staffCode: { date: new Date(data.date), staffCode: data.staffCode } },
    update: {
      patternCode: data.patternCode,
      startTime: data.startTime,
      endTime: data.endTime,
      note: data.note,
      source: 'manual',
    },
    create: {
      date: new Date(data.date),
      staffCode: data.staffCode,
      patternCode: data.patternCode,
      startTime: data.startTime,
      endTime: data.endTime,
      note: data.note,
      source: 'manual',
    },
  });

  return NextResponse.json({ data: upserted, message: 'OK' });
}
