/**
 * POST /api/inspect/scan
 * バーコードスキャン処理（JAN または 商品コード）
 *
 * リクエスト: { sessionId, scanValue, qty }
 *
 * 処理:
 *  1. session → order の items を取得
 *  2. judgeScan() で結果区分判定
 *  3. matched なら scannedQty を加算
 *  4. insp_logs に記録（type=scan）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, ownsSession } from '@/lib/auth/permissions';
import { judgeScan } from '@/lib/inspection';

const Body = z.object({
  sessionId: z.string().min(1),
  scanValue: z.string().min(1),
  qty: z.number().int().positive().default(1),
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
    include: {
      order: {
        include: {
          items: {
            include: { product: { select: { jan: true } } },
          },
        },
      },
    },
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

  const judge = judgeScan(session.order.items, parsed.data.scanValue, parsed.data.qty);

  // ログは必ず残す（matched / over / not_found / already_done すべて）
  await prisma.inspLog.create({
    data: {
      sessionId: session.id,
      type: 'scan',
      itemCode: parsed.data.scanValue,
      qty: parsed.data.qty,
      note: judge.result,
    },
  });

  if (judge.result === 'matched' && judge.itemId) {
    await prisma.shippingOrderItem.update({
      where: { id: judge.itemId },
      data: { scannedQty: judge.nextScannedQty! },
    });
  }

  return NextResponse.json({
    data: { result: judge.result, itemId: judge.itemId ?? null },
    message: 'OK',
  });
}
