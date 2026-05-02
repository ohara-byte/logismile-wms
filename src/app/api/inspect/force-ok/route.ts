/**
 * POST /api/inspect/force-ok
 * 強制OK（在庫切れ等で物理的にスキャンせず完了扱いにする）
 *
 * リクエスト: { sessionId, itemId, reason }
 *
 * 処理:
 *  1. shipping_order_items.force_ok=true, scannedQty=qty にする
 *  2. insp_logs に type=force_ok / note=reason 記録
 *  3. insp_sessions.force_ok_count をインクリメント
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  sessionId: z.string().min(1),
  itemId: z.number().int().positive(),
  reason: z.string().min(1, '理由は必須です'),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const session = await prisma.inspSession.findUnique({
    where: { id: parsed.data.sessionId },
    select: { id: true, orderId: true, completedAt: true },
  });
  if (!session) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'セッションがありません' }, { status: 404 });
  }
  if (session.completedAt) {
    return NextResponse.json(
      { error: 'CONFLICT', message: 'セッションは既に完了しています' },
      { status: 409 },
    );
  }

  const item = await prisma.shippingOrderItem.findUnique({
    where: { id: parsed.data.itemId },
    select: { id: true, orderId: true, qty: true },
  });
  if (!item || item.orderId !== session.orderId) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'この明細はセッション対象外です' },
      { status: 404 },
    );
  }

  await prisma.$transaction([
    prisma.shippingOrderItem.update({
      where: { id: item.id },
      data: { forceOk: true, forceReason: parsed.data.reason, scannedQty: item.qty },
    }),
    prisma.inspLog.create({
      data: {
        sessionId: session.id,
        type: 'force_ok',
        itemCode: String(item.id),
        qty: item.qty,
        note: parsed.data.reason,
      },
    }),
    prisma.inspSession.update({
      where: { id: session.id },
      data: { forceOkCount: { increment: 1 } },
    }),
    prisma.alert.create({
      data: {
        type: 'force_ok',
        severity: 'warn',
        title: `強制OK: itemId=${item.id}`,
        body: parsed.data.reason,
        refCode: String(item.id),
      },
    }),
  ]);

  return NextResponse.json({ data: { itemId: item.id }, message: 'OK' });
}
