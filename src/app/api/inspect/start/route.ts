/**
 * POST /api/inspect/start
 * 検品セッション開始
 *
 * リクエスト: { pkNo, staffCode?, deviceCode? }
 *   staffCode/deviceCode はモバイル系の自動セット可（社員番号セッションから）。
 *
 * 処理:
 *  1. shipping_orders.pk_no で order を取得（deleted_at IS NULL, status pending|inspecting|held）
 *  2. 既存セッションがあればそれを返す（途中再開）
 *  3. なければ新規 insp_sessions レコード作成 + status='inspecting'
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  pkNo: z.string().min(1),
  staffCode: z.string().optional(),
  deviceCode: z.string().optional(),
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

  // 認証情報から自動補完。明示指定があればそちらを優先。
  const staffCode = parsed.data.staffCode ?? guard.auth.staffCode;
  const deviceCode = parsed.data.deviceCode ?? guard.auth.deviceCode;
  if (!staffCode) {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'staffCode を解決できません' },
      { status: 422 },
    );
  }

  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo: parsed.data.pkNo, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: `ピッキング№が見つかりません: ${parsed.data.pkNo}` },
      { status: 404 },
    );
  }
  if (order.status === 'packed' || order.status === 'shipped') {
    return NextResponse.json(
      { error: 'CONFLICT', message: `この伝票は既に ${order.status} 状態です` },
      { status: 409 },
    );
  }

  // 既存セッションがあればそれを返す
  const existing = await prisma.inspSession.findUnique({
    where: { orderId: order.id },
    select: { id: true, staffCode: true, deviceCode: true, startedAt: true, completedAt: true },
  });
  if (existing) {
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
