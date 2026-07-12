/**
 * POST /api/inspect/set-qty
 * 検品数の修正（③現場要望）。誤って入力/スキャンした数量を「絶対値でセット」し直す（減算も可）。
 *
 * リクエスト: { sessionId, itemId, qty }
 *   - scannedQty を qty（0〜必要数）に直接セットする（scan の加算とは別）。
 *   - 修正は insp_logs(type=qty_correct) に記録して追跡可能にする。
 *
 * 処理:
 *  1. セッション所有者・未完了を確認
 *  2. 明細がセッション対象か確認
 *  3. scannedQty = clamp(0, qty, item.qty) にセット（減らす修正も許可）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, ownsSession } from '@/lib/auth/permissions';

const Body = z.object({
  sessionId: z.string().min(1),
  itemId: z.number().int().positive(),
  qty: z.number().int().min(0),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
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
  if (!session) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'セッションがありません' }, { status: 404 });
  }
  if (!ownsSession(guard.auth, session)) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '他の担当者のセッションは操作できません' },
      { status: 403 },
    );
  }
  if (session.completedAt) {
    return NextResponse.json(
      { error: 'CONFLICT', message: 'セッションは既に完了しています' },
      { status: 409 },
    );
  }

  const item = await prisma.shippingOrderItem.findUnique({
    where: { id: parsed.data.itemId },
    select: { id: true, orderId: true, qty: true, scannedQty: true },
  });
  if (!item || item.orderId !== session.orderId) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'この明細はセッション対象外です' },
      { status: 404 },
    );
  }

  // 必要数を上限に、0〜qty でセット（誤入力の減算修正も可）。
  const newQty = Math.max(0, Math.min(parsed.data.qty, item.qty));

  await prisma.$transaction([
    prisma.shippingOrderItem.update({
      where: { id: item.id },
      // 修正で必要数未満に戻す場合は forceOk も解除（整合）。
      data: { scannedQty: newQty, ...(newQty < item.qty ? { forceOk: false } : {}) },
    }),
    prisma.inspLog.create({
      data: {
        sessionId: session.id,
        type: 'qty_correct',
        itemCode: String(item.id),
        qty: newQty,
        note: `数量修正 ${item.scannedQty}→${newQty}（必要数 ${item.qty}）`,
      },
    }),
  ]);

  return NextResponse.json({ data: { itemId: item.id, scannedQty: newQty }, message: 'OK' });
}
