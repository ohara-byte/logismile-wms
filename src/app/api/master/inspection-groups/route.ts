/**
 * GET /api/master/inspection-groups
 *
 * 検品グループマスタの一覧（assignment / 割当ガント等の旧 API 名）。
 * 実体は `/api/master/groups` と同一。互換性のためのエイリアス。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const items = await prisma.inspectionGroup.findMany({
    orderBy: [{ id: 'asc' }],
  });
  const out = items.map((g) => ({
    ...g,
    tablesText: g.tables.join(', '),
  }));
  return NextResponse.json({ data: { items: out }, message: 'OK' });
}
