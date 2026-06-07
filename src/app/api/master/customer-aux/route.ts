/**
 * GET  /api/master/customer-aux   一覧
 * POST /api/master/customer-aux   作成
 *
 * Sprint Y-13: 顧客属性補助マスタ（作業補助タブ）
 *  - 個人/企業/置き配/誤配多発 等の補助情報
 *  - 検品時のアラート・伝票画面でのバッジ表示などに将来連携
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole, requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const nullableStr = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? null : v));

const Body = z.object({
  customerName: z.string().min(1).max(100),
  customerKana: nullableStr(100),
  attrType: z
    .enum(['corp', 'personal', 'leave_at_door', 'redelivery_alert', 'attention', 'note'])
    .default('note'),
  note: nullableStr(1000),
  active: z.boolean().default(true),
});

export async function GET() {
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;

  const items = await prisma.customerAuxAttr.findMany({
    orderBy: [{ active: 'desc' }, { customerName: 'asc' }],
  });
  return NextResponse.json({
    data: {
      items: items.map((it) => ({
        ...it,
        createdAt: it.createdAt.toISOString(),
        updatedAt: it.updatedAt.toISOString(),
      })),
    },
    message: 'OK',
  });
}

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    const detailed = parsed.error.issues
      .map((i) => `[${(i.path ?? []).join('.') || '(body)'}] ${i.message}`)
      .join(' / ');
    return NextResponse.json(
      { error: 'VALIDATION', message: detailed || 'バリデーションエラー' },
      { status: 422 },
    );
  }

  try {
    const created = await prisma.customerAuxAttr.create({
      data: {
        ...parsed.data,
        createdBy: guard.auth.staffCode ?? null,
      },
    });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json(
        { error: 'CONFLICT', message: '同じ顧客名が既に登録されています' },
        { status: 409 },
      );
    }
    return maskError(
      '[POST /api/master/customer-aux]',
      e,
      'INTERNAL',
      500,
      '登録に失敗しました',
    );
  }
}
