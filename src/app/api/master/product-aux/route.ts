/**
 * GET  /api/master/product-aux   一覧
 * POST /api/master/product-aux   作成
 *
 * 商品属性補助マスタ（基幹商品マスタを補完する WMS 拡張属性）。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  productCode: z.string().min(1).max(20),
  dispName: z.string().max(100).nullable().optional(),
  tempZone: z.enum(['ambient', 'cool', 'frozen']).default('ambient'),
  specialPkg: z.string().max(30).nullable().optional(),
  stdSec: z.number().int().min(0).default(0),
  transferred: z.boolean().default(false),
  wMm: z.number().int().min(0).default(0),
  dMm: z.number().int().min(0).default(0),
  hMm: z.number().int().min(0).default(0),
  note: z.string().nullable().optional(),
});

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const items = await prisma.productAuxAttr.findMany({
    orderBy: [{ productCode: 'asc' }],
    take: 1000,
    include: { product: { select: { name: true, jan: true } } },
  });
  return NextResponse.json({
    data: {
      items: items.map((a) => ({
        ...a,
        productName: a.product.name,
        productJan: a.product.jan,
      })),
    },
    message: 'OK',
  });
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
    const created = await prisma.productAuxAttr.create({ data: parsed.data });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `登録に失敗（productCode 既存の可能性）: ${e}` },
      { status: 409 },
    );
  }
}
