/**
 * GET  /api/master/stocks   一覧（admin / manager / lead）
 * POST /api/master/stocks   新規登録（admin / manager）
 *
 * Sprint Z-1: 在庫マスタ CRUD（SKU 単位の在庫サマリ）
 *  - 1 商品 1 行（productCode 主キー）
 *  - qty: 物理在庫
 *  - allocatedQty: 引当済（未出荷）
 *  - 利用可能在庫 = qty - allocatedQty
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  productCode: z.string().min(1).max(20),
  qty: z.number().int().min(0).default(0),
  note: z.string().nullable().optional(),
});

export async function GET() {
  // Sprint Y-15: lead もマスタ閲覧可
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;

  const items = await prisma.stock.findMany({
    orderBy: [{ productCode: 'asc' }],
    include: {
      product: {
        select: {
          name: true,
          jan: true,
          cat: true,
          productType: true,
          safetyStock: true,
          reorderPoint: true,
          active: true,
        },
      },
    },
    take: 100000, // 2026-06-04: 上限実質撤廃（在庫マスタ全件表示）
  });

  // 利用可能在庫を計算してフロントへ渡す
  const out = items.map((s) => ({
    productCode: s.productCode,
    productName: s.product.name,
    productJan: s.product.jan,
    productCat: s.product.cat,
    productType: s.product.productType,
    qty: s.qty,
    allocatedQty: s.allocatedQty,
    availableQty: Math.max(s.qty - s.allocatedQty, 0),
    safetyStock: s.product.safetyStock,
    reorderPoint: s.product.reorderPoint,
    /// 補充推奨フラグ（reorderPoint <= availableQty なら補充検討）
    needsReorder:
      s.product.reorderPoint != null &&
      Math.max(s.qty - s.allocatedQty, 0) <= s.product.reorderPoint,
    inspectedAt: s.inspectedAt?.toISOString() ?? null,
    inspectedBy: s.inspectedBy,
    updatedAt: s.updatedAt.toISOString(),
  }));

  return NextResponse.json({ data: { items: out }, message: 'OK' });
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

  // 商品が存在するか
  const product = await prisma.product.findUnique({
    where: { code: parsed.data.productCode },
    select: { code: true },
  });
  if (!product) {
    return NextResponse.json(
      { error: 'VALIDATION', message: '指定された商品コードが存在しません' },
      { status: 422 },
    );
  }

  try {
    const created = await prisma.stock.create({
      data: {
        productCode: parsed.data.productCode,
        qty: parsed.data.qty,
        // 新規作成時は引当ゼロから
        allocatedQty: 0,
      },
    });
    // 初期登録 movement を記録
    if (parsed.data.qty !== 0) {
      await prisma.stockMovement.create({
        data: {
          productCode: parsed.data.productCode,
          type: 'inbound',
          qtyDelta: parsed.data.qty,
          note: parsed.data.note ?? '在庫マスタ初期登録',
          createdBy: guard.auth.staffCode ?? null,
        },
      });
    }
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/master/stocks]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました（商品コード重複の可能性）',
    );
  }
}
