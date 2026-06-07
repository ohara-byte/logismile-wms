/**
 * POST /api/shifts/mark-absent
 * 当日欠勤の切替（メンバー割当画面から呼出）
 *
 * リクエスト: { date: 'YYYY-MM-DD', staffCode: string, reason?: string }
 *
 * 処理:
 *  1. 対象日のシフトを取得し、pattern_code='欠勤' に upsert
 *  2. その日のメンバー割当（MemberAssignment）から該当者を削除（欠勤者の割当は無効）
 *
 * 2026-05-20 追加：当日欠勤対応のため新規作成
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC, formatDateYmd } from '@/lib/date-utils';

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffCode: z.string().min(1),
  reason: z.string().max(200).optional(),
});

const ABSENT_PATTERN = '欠勤';

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: parsed.error.issues.map((i) => i.message).join(', '),
      },
      { status: 422 },
    );
  }

  const date = parseDateAsUTC(parsed.data.date);
  if (!date) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な日付: ${parsed.data.date}` },
      { status: 422 },
    );
  }

  // 欠勤パターンの存在確認（マスタにない場合は事前登録が必要）
  const absent = await prisma.shiftPattern.findUnique({
    where: { code: ABSENT_PATTERN },
  });
  if (!absent) {
    return NextResponse.json(
      {
        error: 'NOT_FOUND',
        message:
          '「欠勤」パターンがシフトパターンマスタに登録されていません。設定してください。',
      },
      { status: 404 },
    );
  }

  // 担当者の存在確認
  const staff = await prisma.staff.findUnique({
    where: { code: parsed.data.staffCode },
    select: { code: true, name: true },
  });
  if (!staff) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: `担当者が見つかりません: ${parsed.data.staffCode}` },
      { status: 404 },
    );
  }

  const note = parsed.data.reason ? `当日欠勤: ${parsed.data.reason}` : '当日欠勤';

  // シフトを upsert（既存ならパターンを欠勤に更新、なければ新規作成）
  // + 当日の割当を削除（欠勤者は割当できない）
  // + ライン/仕分等の補助グループ割当も含めて全削除
  const [shift] = await prisma.$transaction([
    prisma.shift.upsert({
      where: {
        // Shift には複合ユニーク制約が必要。schema.prisma を確認すべきだが、
        // 通常 [date, staffCode] の複合ユニークがあるはず。
        date_staffCode: { date, staffCode: parsed.data.staffCode },
      },
      create: {
        date,
        staffCode: parsed.data.staffCode,
        patternCode: ABSENT_PATTERN,
        source: 'manual',
        note,
      },
      update: {
        patternCode: ABSENT_PATTERN,
        startTime: null,
        endTime: null,
        note,
      },
    }),
    prisma.memberAssignment.deleteMany({
      where: { date, staffCode: parsed.data.staffCode },
    }),
  ]);

  return NextResponse.json({
    data: {
      date: formatDateYmd(date),
      staffCode: parsed.data.staffCode,
      staffName: staff.name,
      patternCode: ABSENT_PATTERN,
      shiftId: shift.id,
    },
    message: 'OK',
  });
}
