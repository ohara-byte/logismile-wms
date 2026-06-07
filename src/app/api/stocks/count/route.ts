/**
 * POST /api/stocks/count
 *
 * Sprint Z-1: 在庫検品（物理カウント）の反映。
 *  - 認証: admin / manager / staff（モバイル含む）
 *  - Body: { productCode, qty }
 *  - 処理: Stock.qty 更新 + StockMovement(type='inspection_count') 記録
 *  - 引当済を下回る数量への変更は拒否（既存引当を壊さない）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  productCode: z.string().min(1).max(20),
  qty: z.number().int().min(0),
  note: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
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

  // Stock 行を upsert（無ければ作成）
  const before = await prisma.stock.upsert({
    where: { productCode: parsed.data.productCode },
    create: { productCode: parsed.data.productCode, qty: 0, allocatedQty: 0 },
    update: {},
  });

  if (parsed.data.qty < before.allocatedQty) {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `引当済 ${before.allocatedQty} 個を下回る数量には変更できません`,
      },
      { status: 409 },
    );
  }

  const delta = parsed.data.qty - before.qty;

  const [updated] = await prisma.$transaction([
    prisma.stock.update({
      where: { productCode: parsed.data.productCode },
      data: {
        qty: parsed.data.qty,
        inspectedAt: new Date(),
        inspectedBy: guard.auth.staffCode ?? null,
      },
    }),
    ...(delta !== 0
      ? [
          prisma.stockMovement.create({
            data: {
              productCode: parsed.data.productCode,
              type: 'inspection_count',
              qtyDelta: delta,
              refType: 'session',
              refId: guard.auth.deviceCode ?? null,
              note: parsed.data.note ?? '在庫検品（ハンディ）',
              createdBy: guard.auth.staffCode ?? null,
            },
          }),
        ]
      : []),
  ]);

  return NextResponse.json({
    data: {
      productCode: updated.productCode,
      qty: updated.qty,
      allocatedQty: updated.allocatedQty,
      availableQty: Math.max(updated.qty - updated.allocatedQty, 0),
      delta,
    },
    message: 'OK',
  });
}
