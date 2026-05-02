/**
 * POST /api/inspect/start
 * 検品セッション開始
 *
 * リクエスト: { pkNo }
 *   ★ staffCode / deviceCode は **必ず認証情報から取得**（Body 受領を廃止）。
 *     Body 受領を許すと別人名義の検品セッションを作成できる IDOR / 監査偽装になる。
 *
 * 処理:
 *  1. shipping_orders.pk_no で order を取得（deleted_at IS NULL）
 *  2. packed/shipped なら 409
 *  3. 既存セッションがあれば、所有者一致時のみ RESUMED（staff ロールは他人のセッションに継続できない）
 *  4. なければ新規 insp_sessions レコード作成 + status='inspecting'
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  pkNo: z.string().min(1),
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

  // 認証情報のみを信頼する。Body での上書きは受け付けない。
  const staffCode = guard.auth.staffCode;
  const deviceCode = guard.auth.deviceCode;
  if (!staffCode) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '検品作業には staff レコードに紐付くアカウントが必要です' },
      { status: 403 },
    );
  }

  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo: parsed.data.pkNo, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: `ピッキング№が見つかりません` },
      { status: 404 },
    );
  }
  if (order.status === 'packed' || order.status === 'shipped') {
    return NextResponse.json(
      { error: 'CONFLICT', message: `この伝票は既に ${order.status} 状態です` },
      { status: 409 },
    );
  }

  // 既存セッションがあれば、所有者一致時のみ RESUMED。
  // staff ロールは自分のセッションのみ継続可（admin/manager は再開可）。
  const existing = await prisma.inspSession.findUnique({
    where: { orderId: order.id },
    select: { id: true, staffCode: true, deviceCode: true, startedAt: true, completedAt: true },
  });
  if (existing) {
    if (guard.auth.role === 'staff' && existing.staffCode !== staffCode) {
      return NextResponse.json(
        { error: 'CONFLICT', message: '他の担当者が検品中です' },
        { status: 409 },
      );
    }
    return NextResponse.json({ data: existing, message: 'RESUMED' });
  }

  const [, session] = await prisma.$transaction([
    prisma.shippingOrder.update({
      where: { id: order.id },
      data: { status: 'inspecting' },
    }),
    prisma.inspSession.create({
      data: {
        orderId: order.id,
        staffCode,
        deviceCode,
      },
      select: { id: true, staffCode: true, deviceCode: true, startedAt: true, completedAt: true },
    }),
  ]);

  return NextResponse.json({ data: session, message: 'OK' });
}
