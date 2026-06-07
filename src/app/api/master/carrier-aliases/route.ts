/**
 * GET  /api/master/carrier-aliases   一覧
 * POST /api/master/carrier-aliases   作成
 *
 * 2026-06-02: 運送会社「便種名 → carrier_code」マッピングのDBマスタ化。
 *   基幹 CSV の配送便種文字列を WMS の運送会社コードへ対応付ける編集可能マスタ。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  aliasName: z.string().min(1).max(100),
  carrierCode: z.string().min(1).max(20),
  active: z.boolean().default(true),
  note: z.string().nullable().optional(),
});

export async function GET() {
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;
  const items = await prisma.carrierAlias.findMany({
    orderBy: [{ carrierCode: 'asc' }, { aliasName: 'asc' }],
  });
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
  // 参照先 carrier の実在チェック（FK 違反を分かりやすいメッセージに）
  const carrier = await prisma.carrier.findUnique({
    where: { code: parsed.data.carrierCode },
    select: { code: true },
  });
  if (!carrier) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `運送会社コード「${parsed.data.carrierCode}」が存在しません` },
      { status: 422 },
    );
  }
  try {
    const created = await prisma.carrierAlias.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/carrier-aliases]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（便種名の重複の可能性）',
    );
  }
}
