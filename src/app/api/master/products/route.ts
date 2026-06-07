/**
 * GET  /api/master/products   一覧
 * POST /api/master/products   作成
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  code: z.string().min(1).max(20),
  jan: z.string().max(13).nullable().optional(),
  name: z.string().min(1).max(100),
  cat: z.string().min(1).max(20),
  pkg: z.string().max(20).default('箱'),
  price: z.number().int().min(0).default(0),
  leadDays: z.number().int().min(0).default(0),
  stdSec: z.number().int().min(0).default(0),
  frozen: z.boolean().default(false),
  special: z.boolean().default(false),
  noshi: z.boolean().default(false),
  active: z.boolean().default(true),
  // Sprint Z-1: 在庫引当用
  // Sprint Y-13: 既定を pass_through に変更（大江ノ郷の基本運用）
  productType: z
    .enum(['warehouse', 'pass_through', 'made_to_order'])
    .default('pass_through'),
  safetyStock: z.number().int().min(0).default(0),
  reorderPoint: z.number().int().min(0).nullable().optional(),
});

export async function GET() {
  // Sprint Y-15: lead もマスタ閲覧可
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;
  const items = await prisma.product.findMany({
    orderBy: [{ active: 'desc' }, { code: 'asc' }],
    take: 100000, // 2026-06-04: 上限実質撤廃（商品マスタ全件表示）
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
    const created = await prisma.product.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/products]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（コード重複の可能性）',
    );
  }
}
