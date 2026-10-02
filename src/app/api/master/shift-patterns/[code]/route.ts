import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';
import { normalizePatternTimes } from '@/lib/shift-pattern-time';

const Body = z.object({
  name: z.string().min(1).max(50),
  startTime: z.string().max(5).nullable().optional(),
  endTime: z.string().max(5).nullable().optional(),
  breakMin: z.number().int().min(0).default(0),
  isOff: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

export async function PUT(
  req: Request,
  { params }: { params: { code: string } },
) {
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

  // ★ 時刻は必ず "HH:MM"（半角・ゼロ付き2桁）で保存する（不具合要望 No.3）。
  //   全角コロン・ゼロなし・コロンなしは直して保存し、読めないものだけ拒否する。
  const times = normalizePatternTimes(parsed.data);
  if (!times.ok) {
    return NextResponse.json({ error: 'VALIDATION', message: times.error }, { status: 422 });
  }
  const data = { ...parsed.data, startTime: times.startTime, endTime: times.endTime };
  const code = decodeURIComponent(params.code);
  try {
    const updated = await prisma.shiftPattern.update({ where: { code }, data });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'パターンが見つかりません' },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { code: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const code = decodeURIComponent(params.code);
  try {
    await prisma.shiftPattern.delete({ where: { code } });
    return NextResponse.json({ data: { code }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/shift-patterns]',
      e,
      'CONFLICT',
      409,
      '削除できません（参照中の可能性があります）',
    );
  }
}
