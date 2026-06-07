/**
 * GET /api/stocks/[productCode]
 *
 * Sprint Z-1: ハンディ在庫検品で参照する単一在庫情報。
 *  - productCode で直接、または JAN でも検索可能（Stock テーブルに JAN は無いので Product 経由）
 *  - 認証: admin / manager / staff（モバイル含む）
 *  - 結果: stock + product 情報の合体オブジェクト
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(
  _req: Request,
  { params }: { params: { productCode: string } },
) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const key = decodeURIComponent(params.productCode);

  // まず productCode で検索、無ければ JAN で検索
  let product = await prisma.product.findUnique({
    where: { code: key },
    select: {
      code: true,
      name: true,
      jan: true,
      productType: true,
    },
  });
  if (!product) {
    const byJan = await prisma.product.findFirst({
      where: { jan: key },
      select: {
        code: true,
        name: true,
        jan: true,
        productType: true,
      },
    });
    if (byJan) product = byJan;
  }

  if (!product) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: '商品が見つかりません' },
      { status: 404 },
    );
  }

  // Stock 行が無ければ作成（qty=0）
  const stock = await prisma.stock.upsert({
    where: { productCode: product.code },
    create: { productCode: product.code, qty: 0, allocatedQty: 0 },
    update: {},
  });

  return NextResponse.json({
    data: {
      productCode: product.code,
      productName: product.name,
      productJan: product.jan,
      productType: product.productType,
      qty: stock.qty,
      allocatedQty: stock.allocatedQty,
      availableQty: Math.max(stock.qty - stock.allocatedQty, 0),
    },
    message: 'OK',
  });
}
