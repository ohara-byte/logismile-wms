/**
 * GET /api/link/unmap
 * 未マップ一覧（A-11b）
 *
 * モック準拠（管理用PCモック_v0.22.html L3066-3068）。
 *
 * 応答:
 *   {
 *     products: [{ code, name, jan, lastImportedAt }],  // ProductAuxAttr 未登録
 *     customers: [],  // CustomerAuxAttr 未実装のため空
 *   }
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  // ProductAuxAttr が紐付いていない active な商品 = 未マップ
  const products = await prisma.product.findMany({
    where: { active: true, auxAttr: { is: null } },
    orderBy: { code: 'asc' },
    select: { code: true, name: true, jan: true, cat: true, frozen: true },
    take: 100000, // 2026-06-04: 上限実質撤廃（未マップ商品の取りこぼし防止）
  });

  return NextResponse.json({
    data: {
      products: products.map((p) => ({
        code: p.code,
        name: p.name,
        jan: p.jan,
        cat: p.cat,
        frozen: p.frozen,
      })),
      customers: [],
      customerNote: '顧客属性補助マスタは現在未実装（A-11b 後の拡張予定）',
    },
    message: 'OK',
  });
}
