/**
 * POST /api/orders/match/carryover
 * 未検品照合の翌日繰越 一括実行（A-12）
 *
 * 対象: 当日 shipDate AND status NOT IN ('packed','shipped') AND
 *       matchStatus != 'none'（バーコード or 目視で照合済）
 *
 * 処理: shipDate を翌日に更新し matchStatus をリセット
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  reason: z.string().min(1).default('一括翌日繰越処理'),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const dateStr = parsed.data.date ?? new Date().toISOString().slice(0, 10);
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  // 対象抽出
  const targets = await prisma.shippingOrder.findMany({
    where: {
      shipDate: { gte: date, lt: tomorrow },
      deletedAt: null,
      status: { notIn: ['packed', 'shipped'] },
      matchStatus: { not: 'none' },
    },
    select: { id: true, pkNo: true, shipDate: true },
  });

  if (targets.length === 0) {
    return NextResponse.json({
      data: { affected: 0, items: [] },
      message: '対象がありません',
    });
  }

  const actor = guard.auth.staffCode ?? guard.auth.email ?? 'unknown';

  await prisma.$transaction([
    prisma.shippingOrder.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: {
        shipDate: tomorrow,
        matchStatus: 'none',
        matchedAt: null,
        matchedBy: null,
      },
    }),
    ...targets.map((t) =>
      prisma.orderAuditLog.create({
        data: {
          orderId: t.id,
          pkNo: t.pkNo,
          action: 'carryover_bulk',
          actedBy: actor,
          reason: parsed.data.reason,
          diff: {
            before: { shipDate: t.shipDate.toISOString() },
            after: { shipDate: tomorrow.toISOString() },
          },
        },
      }),
    ),
  ]);

  return NextResponse.json({
    data: { affected: targets.length, items: targets.map((t) => t.pkNo) },
    message: 'OK',
  });
}
