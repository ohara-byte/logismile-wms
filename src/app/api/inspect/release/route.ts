/**
 * POST /api/inspect/release
 * 検品中断（破棄）— 2026-06-14
 *
 * 保留(hold)とは別。途中までの検品を「完全に破棄」して伝票を未検品に戻す。
 * 処理:
 *  - shipping_order_items.scanned_qty = 0 / force_ok = false / force_reason(code) = null（部分検品を破棄）
 *  - shipping_orders.status = 'pending' / hold_reason = null
 *  - insp_sessions を削除（insp_logs は onDelete: Cascade で連動削除）→ 次回はピッキングNoから新規開始
 *
 * 保留(hold)＝保持／中断(release)＝完全リリース、という現場運用の分離（ユーザー要望）。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, ownsSession } from '@/lib/auth/permissions';

const Body = z.object({
  sessionId: z.string().min(1),
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
    select: { id: true, orderId: true, staffCode: true, completedAt: true },
  });
  if (!session || session.completedAt) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'セッションがないか既に完了しています' },
      { status: 404 },
    );
  }
  if (!ownsSession(guard.auth, session)) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '他の担当者のセッションは操作できません' },
      { status: 403 },
    );
  }

  // 部分検品を破棄 → 伝票を未検品(pending)へ → セッション削除（ログはCascade）
  await prisma.$transaction([
    prisma.shippingOrderItem.updateMany({
      where: { orderId: session.orderId },
      data: { scannedQty: 0, forceOk: false, forceReason: null, forceReasonCode: null },
    }),
    prisma.shippingOrder.update({
      where: { id: session.orderId },
      data: { status: 'pending', holdReason: null },
    }),
    prisma.inspSession.delete({ where: { id: session.id } }),
  ]);

  return NextResponse.json({ data: { released: true }, message: 'RELEASED' });
}
