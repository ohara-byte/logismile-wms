/**
 * GET /api/orders/deleted
 * 削除済み伝票一覧（admin/manager のみ）
 *
 * クエリ:
 *  - from / to: 削除日範囲（YYYY-MM-DD）
 *  - q: PkNo / 配送先 部分一致
 *  - deletedBy: 削除担当者コード
 *  - page / limit
 */

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const q = searchParams.get('q')?.trim();
  const deletedBy = searchParams.get('deletedBy');
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);

  const where: Prisma.ShippingOrderWhereInput = {
    deletedAt: {
      not: null,
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    },
    ...(deletedBy ? { deletedBy } : {}),
    ...(q
      ? {
          OR: [
            { pkNo: { contains: q, mode: 'insensitive' } },
            { destName: { contains: q, mode: 'insensitive' } },
            { destAddr: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.shippingOrder.findMany({
      where,
      orderBy: { deletedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        pkNo: true,
        shipDate: true,
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        destName: true,
        invoiceNo: true,
      },
    }),
    prisma.shippingOrder.count({ where }),
  ]);

  return NextResponse.json({ data: { items, total, page, limit }, message: 'OK' });
}
