/**
 * POST /api/mfg/bulk-approve
 *
 * Sprint Z-4: 一括承認 / 一括解除。
 *  - body: { ids: number[], approved: boolean }
 *  - status が draft/pending のもののみ更新（sent/completed/cancelled は無視）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

const Body = z.object({
  ids: z.array(z.number().int()).min(1),
  approved: z.boolean(),
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

  const result = await prisma.manufacturingInstruction.updateMany({
    where: {
      id: { in: parsed.data.ids },
      status: { in: ['draft', 'pending'] },
    },
    data: { approved: parsed.data.approved },
  });

  return NextResponse.json({
    data: { count: result.count },
    message: 'OK',
  });
}
