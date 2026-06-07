/**
 * GET /api/master/employment-types
 * 雇用区分マスタ一覧（シフト UI で 担当者カードに 雇用区分名 を表示する用途）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET() {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const items = await prisma.employmentType.findMany({
    select: {
      code: true,
      name: true,
      dailyHours: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json({ data: { items }, message: 'OK' });
}
