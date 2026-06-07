/**
 * POST /api/orders/match/bulk-action
 * 出荷照合タブの一括処理（強制完了 / 翌日繰越 / キャンセル）
 *
 * リクエスト: { date: YYYY-MM-DD, action: 'complete'|'carry'|'cancel', reason }
 *
 * 対象: 当日 shipDate AND status NOT IN ('packed','shipped') AND
 *       matchStatus != 'none'（バーコード or 目視で照合済の未検品）
 *
 * 副作用:
 *   complete : status='packed' に強制更新（force_complete アラート起票）
 *   carry    : shipDate を翌日に変更 + matchStatus リセット
 *   cancel   : deletedAt をセット（論理削除）
 *
 * 単票版 /api/orders/[pkNo]/match-action のロジックを踏襲し、行ごとに
 * order_audit_logs に追記する。
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
  action: z.enum(['complete', 'carry', 'cancel']),
  reason: z.string().min(1, '理由は必須です').max(500),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
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

  const { action, reason } = parsed.data;

  const dateStr = parsed.data.date ?? new Date().toISOString().slice(0, 10);
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 対象抽出（照合済 × 未検品）
  const targets = await prisma.shippingOrder.findMany({
    where: {
      shipDate: { gte: date, lt: tomorrow },
      deletedAt: null,
      status: { notIn: ['packed', 'shipped'] },
      matchStatus: { not: 'none' },
    },
    select: { id: true, pkNo: true, status: true, shipDate: true },
  });

  if (targets.length === 0) {
    return NextResponse.json({
      data: { affected: 0, items: [] },
      message: '対象がありません（照合済かつ未検品の伝票が見当たりません）',
    });
  }

  const actor = guard.auth.staffCode ?? guard.auth.email ?? 'unknown';
  const now = new Date();

  // action 別に一括処理
  switch (action) {
    case 'complete': {
      await prisma.$transaction([
        prisma.shippingOrder.updateMany({
          where: { id: { in: targets.map((t) => t.id) } },
          data: { status: 'packed' },
        }),
        ...targets.map((t) =>
          prisma.orderAuditLog.create({
            data: {
              orderId: t.id,
              pkNo: t.pkNo,
              action: 'force_complete_bulk',
              actedBy: actor,
              reason,
              diff: {
                before: { status: t.status },
                after: { status: 'packed' },
              },
            },
          }),
        ),
        // 強制完了は 1 件にまとめて 1 つの集約アラートを出す
        //  （件数が多くなると個別アラートで管理画面が埋まるため）
        prisma.alert.create({
          data: {
            type: 'force_complete',
            severity: 'warn',
            title: `一括強制完了: ${targets.length} 件 (${dateStr})`,
            body: `理由: ${reason}\n対象伝票: ${targets
              .slice(0, 20)
              .map((t) => t.pkNo)
              .join(', ')}${targets.length > 20 ? ' ...' : ''}`,
            refCode: dateStr,
          },
        }),
      ]);
      break;
    }

    case 'carry': {
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
              reason,
              diff: {
                before: { shipDate: t.shipDate.toISOString() },
                after: { shipDate: tomorrow.toISOString() },
              },
            },
          }),
        ),
      ]);
      break;
    }

    case 'cancel': {
      await prisma.$transaction([
        prisma.shippingOrder.updateMany({
          where: { id: { in: targets.map((t) => t.id) } },
          data: {
            deletedAt: now,
            deletedBy: actor,
            deleteReason: reason,
          },
        }),
        ...targets.map((t) =>
          prisma.orderAuditLog.create({
            data: {
              orderId: t.id,
              pkNo: t.pkNo,
              action: 'cancel_bulk',
              actedBy: actor,
              reason,
              diff: {
                before: { deletedAt: null, status: t.status },
                after: { deletedAt: now.toISOString() },
              },
            },
          }),
        ),
      ]);
      break;
    }
  }

  return NextResponse.json({
    data: {
      affected: targets.length,
      action,
      items: targets.map((t) => t.pkNo),
    },
    message: 'OK',
  });
}
