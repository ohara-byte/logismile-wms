/**
 * POST /api/orders/[pkNo]/hold
 * 伝票を保留にする（管理PCの伝票詳細モーダルから直接実行）
 *
 * 既存の /api/inspect/hold は検品セッション必須だが、本エンドポイントは
 * セッション無しでも admin/manager が伝票を保留できるようにする。
 *
 * 処理:
 *  - status='inspecting' 以外で実行可能（検品中は /api/inspect/hold 経由を推奨）
 *  - shipping_orders.status = 'held'、hold_reason = reason
 *  - order_audit_logs に action='hold' で記録
 *
 * POST /api/orders/[pkNo]/hold で reason='' を渡すと保留解除（status='pending'）。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole, resolveActor } from '@/lib/auth/permissions';

const Body = z.object({
  reason: z.string().min(1, '保留理由は必須です'),
});

export async function POST(
  req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json();
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

  const pkNo = decodeURIComponent(params.pkNo);
  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: null },
    select: { id: true, pkNo: true, status: true, holdReason: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'ピッキング№が見つかりません' },
      { status: 404 },
    );
  }

  if (order.status === 'packed') {
    return NextResponse.json(
      { error: 'CONFLICT', message: '梱包完了済の伝票は保留にできません' },
      { status: 409 },
    );
  }

  const staffCode = resolveActor(guard.auth);
  if (!staffCode) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '監査ログ書込のため staff にリンクされたアカウントが必要です' },
      { status: 403 },
    );
  }

  await prisma.$transaction([
    prisma.shippingOrder.update({
      where: { id: order.id },
      data: { status: 'held', holdReason: parsed.data.reason },
    }),
    prisma.orderAuditLog.create({
      data: {
        orderId: order.id,
        pkNo: order.pkNo,
        action: 'hold',
        actedBy: staffCode,
        reason: parsed.data.reason,
        diff: {
          before: { status: order.status, holdReason: order.holdReason },
          after: { status: 'held', holdReason: parsed.data.reason },
        },
      },
    }),
  ]);

  return NextResponse.json({
    data: { pkNo: order.pkNo, status: 'held' },
    message: 'OK',
  });
}

/**
 * DELETE /api/orders/[pkNo]/hold
 * 保留解除（status='held' → 'pending'）
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const pkNo = decodeURIComponent(params.pkNo);
  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: null },
    select: { id: true, pkNo: true, status: true, holdReason: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'ピッキング№が見つかりません' },
      { status: 404 },
    );
  }
  if (order.status !== 'held') {
    return NextResponse.json(
      { error: 'CONFLICT', message: '保留中ではありません' },
      { status: 409 },
    );
  }

  const staffCode = resolveActor(guard.auth);
  if (!staffCode) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '監査ログ書込のため staff にリンクされたアカウントが必要です' },
      { status: 403 },
    );
  }

  await prisma.$transaction([
    prisma.shippingOrder.update({
      where: { id: order.id },
      data: { status: 'pending', holdReason: null },
    }),
    prisma.orderAuditLog.create({
      data: {
        orderId: order.id,
        pkNo: order.pkNo,
        action: 'unhold',
        actedBy: staffCode,
        reason: '保留解除',
        diff: {
          before: { status: 'held', holdReason: order.holdReason },
          after: { status: 'pending', holdReason: null },
        },
      },
    }),
  ]);

  return NextResponse.json({
    data: { pkNo: order.pkNo, status: 'pending' },
    message: 'OK',
  });
}
