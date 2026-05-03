/**
 * GET /api/force-ok
 * 強制OK 一覧（未承認 + 当日承認済）
 *
 * 仕様:
 *   - status=pending : 未承認のみ（既定）
 *   - status=today   : 当日に承認・却下されたもの
 *   - status=all     : 上記マージ
 *   - R01「セット品時間制約」は承認対象外なので除外
 *
 * 応答:
 *   {
 *     pending: ForceItem[],     // 未承認
 *     todayResolved: ForceItem[], // 当日承認/却下済（タイムスタンプ降順）
 *     summary: { pending, todayApproved, todayRejected, todayTotal }
 *   }
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseReasonCode } from '@/lib/force-ok';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const status = (searchParams.get('status') ?? 'all') as 'pending' | 'today' | 'all';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 共通の include 仕様
  const include = Prisma.validator<Prisma.ShippingOrderItemInclude>()({
    order: {
      select: {
        pkNo: true,
        carrierCode: true,
        carrier: { select: { code: true, name: true, short: true, cool: true } },
        inspSession: {
          select: {
            staffCode: true,
            startedAt: true,
            staff: { select: { code: true, name: true } },
            logs: {
              where: { type: 'force_ok' },
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true, itemCode: true },
            },
          },
        },
      },
    },
    product: { select: { jan: true, name: true } },
  });

  const pending =
    status === 'pending' || status === 'all'
      ? await prisma.shippingOrderItem.findMany({
          where: {
            forceOk: true,
            forceApprovalStatus: null,
            OR: [{ forceReasonCode: null }, { forceReasonCode: { not: 'R01' } }],
            order: { deletedAt: null },
          },
          orderBy: { id: 'desc' },
          take: 200,
          include,
        })
      : [];

  const todayResolved =
    status === 'today' || status === 'all'
      ? await prisma.shippingOrderItem.findMany({
          where: {
            forceApprovalStatus: { in: ['approved', 'rejected'] },
            forceApprovedAt: { gte: today, lt: tomorrow },
            order: { deletedAt: null },
          },
          orderBy: { forceApprovedAt: 'desc' },
          take: 200,
          include,
        })
      : [];

  // タイムライン用に正規化
  function shape(it: (typeof pending)[number]) {
    const triggerLog = it.order.inspSession?.logs.find(
      (l) => l.itemCode === String(it.id),
    );
    const triggeredAt = triggerLog?.createdAt ?? it.order.inspSession?.startedAt ?? null;
    const reasonCode = it.forceReasonCode ?? parseReasonCode(it.forceReason);
    return {
      itemId: it.id,
      pkNo: it.order.pkNo,
      productCode: it.productCode,
      productName: it.productName,
      jan: it.product.jan,
      qty: it.qty,
      carrier: it.order.carrier
        ? {
            code: it.order.carrier.code,
            name: it.order.carrier.name,
            short: it.order.carrier.short,
            cool: it.order.carrier.cool,
          }
        : null,
      triggerStaff: it.order.inspSession?.staff
        ? {
            code: it.order.inspSession.staff.code,
            name: it.order.inspSession.staff.name,
          }
        : null,
      triggeredAt: triggeredAt ? triggeredAt.toISOString() : null,
      reasonCode,
      reason: it.forceReason,
      approvalStatus: it.forceApprovalStatus as
        | 'approved'
        | 'rejected'
        | null,
      approvedBy: it.forceApprovedBy,
      approvedAt: it.forceApprovedAt ? it.forceApprovedAt.toISOString() : null,
      rejectReason: it.forceRejectReason,
    };
  }

  const pendingItems = pending.map(shape);
  const todayItems = todayResolved.map(shape);

  const todayApproved = todayItems.filter((i) => i.approvalStatus === 'approved').length;
  const todayRejected = todayItems.filter((i) => i.approvalStatus === 'rejected').length;

  return NextResponse.json({
    data: {
      pending: pendingItems,
      todayResolved: todayItems,
      summary: {
        pending: pendingItems.length,
        todayApproved,
        todayRejected,
        todayTotal: pendingItems.length + todayApproved + todayRejected,
      },
    },
    message: 'OK',
  });
}
