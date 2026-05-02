/**
 * GET  /api/alerts        — アラート一覧
 * POST /api/alerts        — 手動でアラート作成（運用フォローアップ用）
 *
 * クエリ: resolved (true|false), severity, type, limit
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const resolved = searchParams.get('resolved');
  const type = searchParams.get('type');
  const severity = searchParams.get('severity');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 500);

  const items = await prisma.alert.findMany({
    where: {
      ...(resolved === 'true' ? { resolved: true } : resolved === 'false' ? { resolved: false } : {}),
      ...(type ? { type } : {}),
      ...(severity ? { severity } : {}),
    },
    orderBy: [{ resolved: 'asc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return NextResponse.json({ data: { items }, message: 'OK' });
}

const PostBody = z.object({
  type: z.string().min(1),
  severity: z.enum(['warn', 'error', 'info']).default('warn'),
  title: z.string().min(1),
  body: z.string().optional(),
  refCode: z.string().optional(),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const created = await prisma.alert.create({ data: parsed.data });
  return NextResponse.json({ data: created, message: 'OK' });
}
