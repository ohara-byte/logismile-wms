/**
 * GET /api/assignments?date=YYYY-MM-DD     — 当日の割当
 * PUT /api/assignments                      — 当日割当を全置換（Gantt 全体保存）
 * DELETE /api/assignments?date=YYYY-MM-DD   — 全クリア
 *
 * 2026-05-20 修正：日付パースを UTC 真夜中に統一（JST 環境での 1 日ずれ解消）。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { describeOverlap, findOverlaps } from '@/lib/assignment-overlap';
import { parseDateAsUTC, normalizeHHMM } from '@/lib/date-utils';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get('date');
  const date = parseDateAsUTC(dateStr);
  if (!date) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'date は必須 (YYYY-MM-DD)' },
      { status: 422 },
    );
  }

  const items = await prisma.memberAssignment.findMany({
    where: { date },
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
  // 時刻の表記ゆれ（コロン無し "1700"・単桁 "8:0" 等）を正準 "HH:MM" に正規化してから検証・保存する。
  //   → シフトパターン/過去データ由来のゆれを保存時に自己修復し、格納値を常に "HH:MM" に保つ。
  if (json && Array.isArray((json as { assignments?: unknown }).assignments)) {
    for (const a of (json as { assignments: unknown[] }).assignments) {
      if (a && typeof a === 'object') {
        const rec = a as { startTime?: unknown; endTime?: unknown };
        if (typeof rec.startTime === 'string') rec.startTime = normalizeHHMM(rec.startTime);
        if (typeof rec.endTime === 'string') rec.endTime = normalizeHHMM(rec.endTime);
      }
    }
  }
  const parsed = PutBody.safeParse(json);
  if (!parsed.success) {
    // どの項目が不正かを含める（例: assignments.0.startTime）。原因特定を容易にするため。
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
          .join(' / '),
      },
      { status: 422 },
    );
  }
  const { date, assignments } = parsed.data;
  const dateObj = parseDateAsUTC(date);
  if (!dateObj) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${date}` },
      { status: 422 },
    );
  }
  // ★ 2026-10-02（不具合要望 No.4）：同じ担当者の割当が時間で重なっていたら保存しない。
  //   画面だけの防御では「昨日の割当読込」「シフトから反映」等の経路で重複が入る。
  //   重なりは必ず誤り（1人が同じ時間に2か所では作業できない）で、
  //   ダッシュボードの配置人数が多く出て完了予測が早まる実害がある。
  //   12:00 終了と 12:00 開始のように端が接するだけのものは重なりとしない。
  const conflicts = findOverlaps(assignments);
  if (conflicts.length > 0) {
    const names = await prisma.staff.findMany({
      where: { code: { in: Array.from(new Set(conflicts.map((c) => c.a.staffCode))) } },
      select: { code: true, name: true },
    });
    const nameByCode = new Map(names.map((n) => [n.code, n.name]));
    const lines = conflicts
      .slice(0, 10)
      .map((c) => describeOverlap(nameByCode.get(c.a.staffCode) ?? c.a.staffCode, c.a, c.b));
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message:
          `同じ担当者の割当が重なっています（${conflicts.length}件）。時間を分けてから保存してください。\n` +
          lines.join('\n') +
          (conflicts.length > 10 ? `\n…ほか ${conflicts.length - 10} 件` : ''),
      },
      { status: 422 },
    );
  }

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
  const dateStr = searchParams.get('date');
  const date = parseDateAsUTC(dateStr);
  if (!date) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'date は必須 (YYYY-MM-DD)' },
      { status: 422 },
    );
  }

  const result = await prisma.memberAssignment.deleteMany({ where: { date } });
  return NextResponse.json({ data: { deleted: result.count }, message: 'OK' });
}
