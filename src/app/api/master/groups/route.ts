/**
 * GET  /api/master/groups   一覧
 * POST /api/master/groups   作成
 *
 * tables は文字列配列。フォームでは カンマ区切り入力 → サーバ側で分割。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  id: z.string().min(1).max(10),
  name: z.string().min(1).max(20),
  tables: z.union([z.string(), z.array(z.string())]).optional(),
  category: z.string().min(1).max(20),
  needStaff: z.number().int().min(0).default(1),
  note: z.string().nullable().optional(),
});

function normalizeTables(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return v
    .split(/[,、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const items = await prisma.inspectionGroup.findMany({
    orderBy: [{ id: 'asc' }],
  });
  // tables[] を表示用に CSV 文字列でも返す
  const out = items.map((g) => ({
    ...g,
    tablesText: g.tables.join(', '),
  }));
  return NextResponse.json({ data: { items: out }, message: 'OK' });
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
  try {
    const created = await prisma.inspectionGroup.create({
      data: { ...parsed.data, tables: normalizeTables(parsed.data.tables) },
    });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `登録に失敗: ${e}` },
      { status: 409 },
    );
  }
}
