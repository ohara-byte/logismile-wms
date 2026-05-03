/**
 * POST /api/force-ok/[itemId]/reject
 * 強制OK の却下（理由必須）
 *
 * 認証: admin / manager のみ
 * 副作用:
 *   - Alert（type='force_ok', refCode=itemId）を resolved に
 *   - 別途 type='force_ok_rejected' の高優先 Alert を作成（現場へ伝達）
 *
 * 注: 却下しても scannedQty / status は戻さない（現物は出荷済の前提）。
 *     現場へのフォローアップを Alert で通知する運用とする。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  reason: z.string().min(1, '却下理由は必須です').max(500),
});

export async function POST(
  req: Request,
  { params }: { params: { itemId: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const id = parseInt(params.itemId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json(
      { error: 'VALIDATION', message: '不正な itemId' },
      { status: 422 },
    );
  }

  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const item = await prisma.shippingOrderItem.findUnique({
    where: { id },
    select: {
      id: true,
      forceOk: true,
      forceApprovalStatus: true,
      productName: true,
      order: { select: { pkNo: true } },
    },
  });
  if (!item) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'item が見つかりません' }, { status: 404 });
  }
  if (!item.forceOk) {
    return NextResponse.json(
      { error: 'CONFLICT', message: '強制OK ではない明細です' },
      { status: 409 },
    );
  }
  if (item.forceApprovalStatus) {
    return NextResponse.json(
      { error: 'CONFLICT', message: `既に ${item.forceApprovalStatus} 済みです` },
      { status: 409 },
    );
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.shippingOrderItem.update({
      where: { id },
      data: {
        forceApprovalStatus: 'rejected',
        forceApprovedAt: now,
        forceApprovedBy: guard.auth.staffCode ?? guard.auth.email ?? 'unknown',
        forceRejectReason: parsed.data.reason,
      },
    }),
    // 既存の force_ok アラートは解決
    prisma.alert.updateMany({
      where: { type: 'force_ok', refCode: String(id), resolved: false },
      data: {
        resolved: true,
        resolvedAt: now,
        resolvedBy: guard.auth.staffCode ?? null,
      },
    }),
    // 却下を伝える高優先アラートを起票
    prisma.alert.create({
      data: {
        type: 'force_ok_rejected',
        severity: 'error',
        title: `強制OK 却下: ${item.order.pkNo} / ${item.productName}`,
        body: parsed.data.reason,
        refCode: String(id),
      },
    }),
  ]);

  return NextResponse.json({
    data: { itemId: id, status: 'rejected', reason: parsed.data.reason },
    message: 'OK',
  });
}
