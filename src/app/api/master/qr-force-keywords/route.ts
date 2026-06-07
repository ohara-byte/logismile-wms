/**
 * GET  /api/master/qr-force-keywords   一覧
 * POST /api/master/qr-force-keywords   作成
 *
 * 2026-06-02: QR印刷 強制マスタ。取込時、QR印刷フラグが OFF でも
 *   noshiName/noshiPerson が matchText と完全一致したら QR 印刷フラグを ON にする。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  matchText: z.string().min(1).max(100),
  active: z.boolean().default(true),
  note: z.string().nullable().optional(),
});

export async function GET() {
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;
  const items = await prisma.qrForceKeyword.findMany({
    orderBy: [{ matchText: 'asc' }],
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
  try {
    const created = await prisma.qrForceKeyword.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/qr-force-keywords]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（テキストの重複の可能性）',
    );
  }
}
