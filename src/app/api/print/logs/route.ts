/**
 * GET /api/print/logs?limit=10
 * 印刷ログの直近 N 件（admin / manager）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 200);

  const items = await prisma.printLog.findMany({
    orderBy: { printedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      pkNo: true,
      invoiceNo: true,
      printerCode: true,
      deviceCode: true,
      staffCode: true,
      isReprint: true,
      status: true,
      errorMsg: true,
      printedAt: true,
    },
  });

  return NextResponse.json({
    data: {
      // クライアント互換のため createdAt エイリアスも提供
      items: items.map((l) => ({
        ...l,
        createdAt: l.printedAt.toISOString(),
        printedAt: l.printedAt.toISOString(),
      })),
    },
    message: 'OK',
  });
}
