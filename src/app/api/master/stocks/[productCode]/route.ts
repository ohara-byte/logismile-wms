/**
 * PUT    /api/master/stocks/[productCode]   更新（数量直接編集）
 * DELETE /api/master/stocks/[productCode]   削除（在庫レコード自体の削除）
 *
 * Sprint Z-1: 在庫マスタ編集
 *  - 数量を直接編集すると StockMovement(type='adjust') が記録される
 *  - 引当済（allocatedQty > 0）のレコードは削除不可
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  qty: z.number().int().min(0),
  note: z.string().nullable().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: { productCode: string } },
) {
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

  const productCode = decodeURIComponent(params.productCode);
  const existing = await prisma.stock.findUnique({
    where: { productCode },
  });
  if (!existing) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: '在庫が見つかりません' },
      { status: 404 },
    );
  }

  // 引当済を下回る数量への変更を防ぐ
  if (parsed.data.qty < existing.allocatedQty) {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `引当済 ${existing.allocatedQty} 個を下回る数量には変更できません`,
      },
      { status: 409 },
    );
  }

  const delta = parsed.data.qty - existing.qty;

  const [updated] = await prisma.$transaction([
    prisma.stock.update({
      where: { productCode },
      data: { qty: parsed.data.qty },
    }),
    ...(delta !== 0
      ? [
          prisma.stockMovement.create({
            data: {
              productCode,
              type: 'adjust',
              qtyDelta: delta,
              note: parsed.data.note ?? '在庫マスタ手動修正',
              createdBy: guard.auth.staffCode ?? null,
            },
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ data: updated, message: 'OK' });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { productCode: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const productCode = decodeURIComponent(params.productCode);
  const existing = await prisma.stock.findUnique({
    where: { productCode },
  });
  if (!existing) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: '在庫が見つかりません' },
      { status: 404 },
    );
  }
  if (existing.allocatedQty > 0) {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `引当済 ${existing.allocatedQty} 個があるため削除できません`,
      },
      { status: 409 },
    );
  }

  try {
    await prisma.stock.delete({ where: { productCode } });
    return NextResponse.json({ data: { productCode }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/stocks]',
      e,
      'CONFLICT',
      409,
      '削除できません（履歴で参照中の可能性）',
    );
  }
}
