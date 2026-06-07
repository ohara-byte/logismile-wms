/**
 * GET  /api/master/printers   一覧
 * POST /api/master/printers   新規登録
 *
 * Sprint Y-6: プリンタマスタ CRUD（IP / ポート / 機種 / 配置 等）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

// IPv4 形式（簡易チェック）
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const Body = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(50),
  ipAddress: z.string().regex(IPV4_RE, 'IPv4 形式（例: 192.168.1.50）で入力してください'),
  port: z.number().int().min(1).max(65535).default(9100),
  model: z.string().max(50).default('SATO CT4-LX'),
  location: z.string().max(50).nullable().optional(),
  labelSize: z.string().max(20).default('30x40'),
  active: z.boolean().default(true),
  note: z.string().nullable().optional(),
});

export async function GET() {
  // Sprint Y-15: lead もマスタ閲覧可
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;

  const items = await prisma.printer.findMany({
    orderBy: [{ active: 'desc' }, { code: 'asc' }],
  });
  return NextResponse.json({ data: { items }, message: 'OK' });
}

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

  try {
    const created = await prisma.printer.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/printers]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（コード/IP の重複の可能性）',
    );
  }
}
