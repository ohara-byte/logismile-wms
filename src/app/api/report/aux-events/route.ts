/**
 * GET /api/report/aux-events?from=&to=
 * 補助マスタ発生数（A-Rep4）
 *
 * 期間内に「未マップ補助マスタ追加が必要になった」回数の推移。
 * Phase 1 簡易実装: ProductAuxAttr の作成日付ベースで日別集計。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parsePeriodFromUrl } from '@/lib/report-period';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const range = parsePeriodFromUrl(req);
  if ('error' in range) return range.error;
  const { from, to } = range;

  // ProductAuxAttr の作成日が無いため、Product の updatedAt or createdAt で代替できないため
  // 現状は ThomasImport.unmapCount を日別で集計
  const imports = await prisma.thomasImport.findMany({
    where: { importedAt: { gte: from, lte: to } },
    select: { importedAt: true, unmapCount: true, fileType: true, filename: true },
    orderBy: { importedAt: 'asc' },
  });

  // 日別合計
  const dailyMap = new Map<string, number>();
  for (const i of imports) {
    const d = i.importedAt.toISOString().slice(0, 10);
    dailyMap.set(d, (dailyMap.get(d) ?? 0) + i.unmapCount);
  }
  const daily = Array.from(dailyMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 現在の未マップ商品数
  const currentUnmap = await prisma.product.count({
    where: { active: true, auxAttr: { is: null } },
  });

  // ProductAuxAttr 登録総数
  const totalAux = await prisma.productAuxAttr.count();

  return NextResponse.json({
    data: {
      daily,
      totalUnmapEvents: daily.reduce((s, d) => s + d.count, 0),
      currentUnmap,
      totalAux,
      recentImports: imports.slice(-10).map((i) => ({
        importedAt: i.importedAt.toISOString(),
        fileType: i.fileType,
        filename: i.filename,
        unmapCount: i.unmapCount,
      })),
    },
    message: 'OK',
  });
}
