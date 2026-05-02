/**
 * GET /api/orders
 * 出荷指示一覧（管理PC用）
 *
 * クエリ:
 *  - shipDate: YYYY-MM-DD
 *  - status: pending|inspecting|packed|shipped|held
 *  - q: PkNo / 配送先 / 納品書№ 部分一致
 *  - carrier: 運送会社コード
 *  - includeDeleted: 'true' で論理削除も含める
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
  const shipDate = searchParams.get('shipDate');
  const status = searchParams.get('status');
  const q = searchParams.get('q')?.trim();
  const carrier = searchParams.get('carrier');
  const includeDeleted = searchParams.get('includeDeleted') === 'true';
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);

  const where: Prisma.ShippingOrderWhereInput = {
    ...(shipDate
      ? {
          shipDate: {
            gte: new Date(shipDate),
            lte: new Date(`${shipDate}T23:59:59.999Z`),
          },
        }
      : {}),
    ...(status ? { status } : {}),
    ...(carrier ? { carrierCode: carrier } : {}),
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(q
      ? {
          OR: [
            { pkNo: { contains: q, mode: 'insensitive' } },
            { invoiceNo: { contains: q, mode: 'insensitive' } },
            { destName: { contains: q, mode: 'insensitive' } },
            { destAddr: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.shippingOrder.findMany({
      where,
      orderBy: [{ shipDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        carrier: { select: { code: true, name: true, short: true, cool: true } },
        items: { select: { qty: true, scannedQty: true, forceOk: true } },
      },
    }),
    prisma.shippingOrder.count({ where }),
  ]);

  return NextResponse.json({
    data: {
      items: items.map((o) => ({
        id: o.id,
        pkNo: o.pkNo,
        shipDate: o.shipDate,
        status: o.status,
        qrPrintFlag: o.qrPrintFlag,
        invoiceNo: o.invoiceNo,
        destName: o.destName,
        carrier: o.carrier,
        itemCount: o.items.length,
        scannedRatio:
          o.items.length === 0
            ? 0
            : Math.round(
                (o.items.filter((it) => it.forceOk || it.scannedQty >= it.qty).length /
                  o.items.length) *
                  100,
              ),
        deletedAt: o.deletedAt,
      })),
      total,
      page,
      limit,
    },
    message: 'OK',
  });
}
