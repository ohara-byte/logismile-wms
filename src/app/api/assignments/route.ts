/**
 * GET /api/assignments?date=YYYY-MM-DD     — 当日の割当
 * PUT /api/assignments                      — 当日割当を全置換（Gantt 全体保存）
 * DELETE /api/assignments?date=YYYY-MM-DD   — 全クリア
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  if (!date) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'date は必須' },
      { status: 422 },
    );
  }

  const items = await prisma.memberAssignment.findMany({
    where: { date: new Date(date) },
    orderBy: [{ groupId: 'asc' }, { startTime: 'asc' }],
    include: {
      staff: { select: { code: true, name: true, kana: true } },
      group: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ data: { items }, message: 'OK' });
}

const PutBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assignments: z.array(
    z.object({
      staffCode: z.string().min(1),
      groupId: z.string().min(1),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  ),
});

export async function PUT(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = PutBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }
  const { date, assignments } = parsed.data;
  const dateObj = new Date(date);
  const createdBy = guard.auth.staffCode ?? null;

  await prisma.$transaction([
    prisma.memberAssignment.deleteMany({ where: { date: dateObj } }),
    ...(assignments.length > 0
      ? [
          prisma.memberAssignment.createMany({
            data: assignments.map((a) => ({
              date: dateObj,
              staffCode: a.staffCode,
              groupId: a.groupId,
              startTime: a.startTime,
              endTime: a.endTime,
              createdBy,
            })),
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ data: { date, count: assignments.length }, message: 'OK' });
}

export async function DELETE(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  if (!date) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'date は必須' },
      { status: 422 },
    );
  }

  const result = await prisma.memberAssignment.deleteMany({ where: { date: new Date(date) } });
  return NextResponse.json({ data: { deleted: result.count }, message: 'OK' });
}
