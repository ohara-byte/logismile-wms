/**
 * POST /api/mfg/bulk-send
 *
 * Sprint Z-4: 「更新」ボタンから一括送信。
 *  - body: { ids?: number[], date?: 'YYYY-MM-DD' }
 *  - 指定がなければ approved=true & status in (draft, pending) を全件対象
 *  - 各件 status='sent' に更新し sentAt セット（DRY-RUN）
 *  - 実機連携は後続スプリントで factory-adapter を実装する想定
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  ids: z.array(z.number().int()).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

  const where: Record<string, unknown> = {
    approved: true,
    status: { in: ['draft', 'pending'] },
  };
  if (parsed.data.ids && parsed.data.ids.length > 0) {
    where.id = { in: parsed.data.ids };
  }
  if (parsed.data.date) {
    const d = new Date(parsed.data.date);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    where.targetDate = { gte: d, lt: next };
  }

  const dryRun = (process.env.FACTORY_DRY_RUN ?? 'true') === 'true';

  try {
    const targets = await prisma.manufacturingInstruction.findMany({
      where: where as never,
      include: { product: { select: { name: true } } },
    });

    if (targets.length === 0) {
      return NextResponse.json({
        data: { sent: 0, dryRun, items: [] },
        message: '対象がありません',
      });
    }

    // DRY-RUN: status='sent' / sentAt セット / factoryRef は仮値
    const now = new Date();
    const ids = targets.map((t) => t.id);
    await prisma.manufacturingInstruction.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'sent',
        sentAt: now,
        factoryRef: dryRun ? `DRY-${now.getTime()}` : null,
      },
    });

    return NextResponse.json({
      data: {
        sent: targets.length,
        dryRun,
        items: targets.map((t) => ({
          id: t.id,
          instructionNo: t.instructionNo,
          productName: t.product.name,
          qty: t.qty,
        })),
      },
      message: 'OK',
    });
  } catch (e) {
    return maskError('[POST /api/mfg/bulk-send]', e, 'CONFLICT', 409, '送信に失敗しました');
  }
}
