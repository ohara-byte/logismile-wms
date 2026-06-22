/**
 * GET  /api/master/app-settings   一覧
 * POST /api/master/app-settings   作成（通常はシード済みキーを編集するだけ）
 *
 * 2026-06-22: 梱包時間の全体設定など key-value 設定。
 *   pack.noshi_add_sec / pack.airpack_add_sec（秒）, pack.airpack_keyword（熨斗名称内の判定語）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  key: z.string().min(1).max(50),
  value: z.string().max(200),
  valueType: z.string().max(10).default('string'),
  label: z.string().max(100).nullable().optional(),
  note: z.string().nullable().optional(),
});

export async function GET() {
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;
  const items = await prisma.appSetting.findMany({ orderBy: [{ key: 'asc' }] });
  return NextResponse.json({ data: { items }, message: 'OK' });
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
    const created = await prisma.appSetting.create({
      data: { ...parsed.data, updatedBy: guard.auth.staffCode ?? null },
    });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError('[POST /api/master/app-settings]', e, 'CONFLICT', 409, '登録に失敗しました（キー重複の可能性）');
  }
}
