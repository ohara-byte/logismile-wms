/**
 * GET /api/link/status
 * 基幹連携ステータス（A-11）
 *
 * 5 つのサマリ:
 *   - connection: 接続状態（CSV 共有確認 — 現状は固定 ok）
 *   - lastImport: 最終取込時刻 + ファイル
 *   - todayImports: 当日取込回数（成功/警告/失敗）
 *   - unmapCount: 未マップ件数（商品 / 顧客）
 *   - nextImport: 次回自動取込時刻（現状は手動取込のみ）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET() {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [last, todayImports] = await Promise.all([
    prisma.thomasImport.findFirst({
      orderBy: { importedAt: 'desc' },
    }),
    prisma.thomasImport.findMany({
      where: { importedAt: { gte: today, lt: tomorrow } },
      orderBy: { importedAt: 'desc' },
    }),
  ]);

  const success = todayImports.filter((i) => i.errorCount === 0 && i.unmapCount === 0).length;
  const warn = todayImports.filter(
    (i) => i.errorCount === 0 && i.unmapCount > 0,
  ).length;
  const failed = todayImports.filter((i) => i.errorCount > 0).length;

  // 未マップ件数: ProductAuxAttr が未登録の Product が「未マップ商品」
  // 顧客は ShippingOrder.destName のうち customer_aux_attrs に未登録なもの
  const unmapProductCount = await prisma.product.count({
    where: { auxAttr: { is: null }, active: true },
  });

  return NextResponse.json({
    data: {
      connection: { status: 'ok', label: '正常', detail: 'CSV 共有: ローカルアップロード' },
      lastImport: last
        ? {
            importedAt: last.importedAt.toISOString(),
            filename: last.filename,
            fileType: last.fileType,
            successCount: last.successCount,
            errorCount: last.errorCount,
          }
        : null,
      todayImports: { total: todayImports.length, success, warn, failed },
      unmap: {
        product: unmapProductCount,
        customer: 0, // CustomerAuxAttr 未実装
      },
      nextImport: null, // 自動取込未実装
    },
    message: 'OK',
  });
}
