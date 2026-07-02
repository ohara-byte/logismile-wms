/**
 * POST /api/handy/receiving-inspect
 *
 * ハンディ「発送日別 受入検品」の記録。
 *  Body: { shipDate: "YYYY-MM-DD", productCode, inspectedQty }
 *  - inspection_count の StockMovement を ship_date + inspectedQty 付きで記録（qtyDelta=0＝在庫プールは触らない）。
 *  - 同一(発送日×商品)の「当日ぶん」は再送で置き換え（当日の createdAt 分を削除→作成＝二重計上防止）。
 *  - 検品照合グリッド④⑧の集計元。認証: admin/manager/staff。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseDateAsUTC } from '@/lib/date-utils';

const Body = z.object({
  shipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'shipDate は YYYY-MM-DD 形式'),
  productCode: z.string().min(1).max(20),
  inspectedQty: z.number().int().min(0),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const shipDate = parseDateAsUTC(parsed.data.shipDate);
  if (!shipDate) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `不正な発送日: ${parsed.data.shipDate}` },
      { status: 422 },
    );
  }

  // 商品実在チェック（Stock 行が無くても登録できるよう Product で確認）
  const product = await prisma.product.findUnique({
    where: { code: parsed.data.productCode },
    select: { code: true },
  });
  if (!product) {
    return NextResponse.json(
      { error: 'VALIDATION', message: `未登録商品: ${parsed.data.productCode}` },
      { status: 422 },
    );
  }

  // 当日(JST)の同一(発送日×商品)受入検品を洗い替え（再カウントは置き換え）。
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.deleteMany({
      where: {
        productCode: parsed.data.productCode,
        type: 'inspection_count',
        refType: 'receiving',
        shipDate,
        createdAt: { gte: todayStart, lt: todayEnd },
      },
    });
    // Stock 行が無いと FK で失敗するため upsert（qty は触らない）
    await tx.stock.upsert({
      where: { productCode: parsed.data.productCode },
      create: { productCode: parsed.data.productCode, qty: 0, allocatedQty: 0 },
      update: {},
    });
    await tx.stockMovement.create({
      data: {
        productCode: parsed.data.productCode,
        type: 'inspection_count',
        qtyDelta: 0, // 発送日別受入検品は在庫プールを触らない（引当・在庫はサイレント）
        inspectedQty: parsed.data.inspectedQty,
        shipDate,
        refType: 'receiving',
        note: `発送日別受入検品 ${parsed.data.shipDate}`,
        createdBy: guard.auth.staffCode ?? null,
      },
    });
  });

  return NextResponse.json({
    data: {
      shipDate: parsed.data.shipDate,
      productCode: parsed.data.productCode,
      inspectedQty: parsed.data.inspectedQty,
    },
    message: 'OK',
  });
}
