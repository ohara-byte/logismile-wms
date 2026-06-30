/**
 * POST /api/stocks/surplus-dispose
 *
 * 余剰在庫の能動的処理（廃棄／戻し）。業務終了レポートの「余剰在庫」から実行する。
 *  - Stock.qty を指定数量だけ減算（available = qty - allocatedQty を下回らない範囲）
 *  - StockMovement(type='disposal', refType='surplus') で監査記録（WMS の監査は StockMovement が正）
 *  - 認証: admin / manager
 *
 * 当初プラン（factory-mode.ts の「余剰在庫」列）では factory_api モードは「警告のみ・翌日継承」
 * までで、能動的な余剰処理は未着手だった。本エンドポイントがその未着手分を担う。
 *
 * Body: { productCode, qty, reason? }  reason 例: '廃棄' / '戻し' / 自由記述
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const Body = z.object({
  productCode: z.string().min(1).max(20),
  qty: z.number().int().min(1),
  reason: z.string().max(200).nullable().optional(),
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
  const { productCode, qty, reason } = parsed.data;

  const stock = await prisma.stock.findUnique({ where: { productCode } });
  if (!stock) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: `在庫が見つかりません: ${productCode}` },
      { status: 404 },
    );
  }
  // 引当済（allocatedQty）は触らない。処理できるのは余剰＝available の範囲のみ。
  const available = Math.max(stock.qty - stock.allocatedQty, 0);
  if (qty > available) {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `余剰（利用可 ${available}個）を超える数量は処理できません`,
      },
      { status: 409 },
    );
  }

  try {
    // 楽観ロック: available が取得時から変わっていない（allocatedQty が増えていない）前提で減算。
    //   同時に引当が走って available が減った場合は count=0 となり 409 を返す。
    const updated = await prisma.stock.updateMany({
      where: {
        productCode,
        qty: { gte: stock.allocatedQty + qty },
        allocatedQty: { equals: stock.allocatedQty },
      },
      data: { qty: { decrement: qty } },
    });
    if (updated.count === 0) {
      return NextResponse.json(
        {
          error: 'CONFLICT',
          message: '在庫状態が変化したため処理できませんでした。再読込してやり直してください。',
        },
        { status: 409 },
      );
    }

    await prisma.stockMovement.create({
      data: {
        productCode,
        type: 'disposal',
        qtyDelta: -qty,
        refType: 'surplus',
        createdBy: guard.auth.staffCode ?? null,
        note: `余剰処理 ${qty}個${reason ? `（${reason}）` : ''}`,
      },
    });

    const after = await prisma.stock.findUnique({ where: { productCode } });
    return NextResponse.json({
      data: { productCode, disposedQty: qty, qtyAfter: after?.qty ?? 0 },
      message: 'OK',
    });
  } catch (e) {
    return maskError(
      '[POST /api/stocks/surplus-dispose]',
      e,
      'INTERNAL',
      500,
      '余剰処理に失敗しました',
    );
  }
}
