/**
 * GET /api/link/imports
 * 取込履歴一覧（A-11 受信ログ）
 *
 * クエリ:
 *   fileType: 'orders' | 'products' | etc.
 *   result:   'ok' | 'warn' | 'error'
 *   date:     YYYY-MM-DD
 *   q:        ファイル名 / 備考の部分一致
 */

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const { searchParams } = new URL(req.url);

  const fileType = searchParams.get('fileType');
  const result = searchParams.get('result');
  const dateStr = searchParams.get('date');
  const q = searchParams.get('q')?.trim();

  const where: Prisma.ThomasImportWhereInput = {};
  if (fileType) where.fileType = fileType;
  if (dateStr) {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    where.importedAt = { gte: d, lt: next };
  }
  if (q) {
    where.OR = [
      { filename: { contains: q, mode: 'insensitive' } },
      { note: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (result === 'ok') where.errorCount = 0;
  if (result === 'error') where.errorCount = { gt: 0 };
  if (result === 'warn') where.AND = [{ errorCount: 0 }, { unmapCount: { gt: 0 } }];

  const items = await prisma.thomasImport.findMany({
    where,
    orderBy: { importedAt: 'desc' },
    take: 200,
    include: { importer: { select: { code: true, name: true } } },
  });

  return NextResponse.json({
    data: {
      items: items.map((i) => ({
        id: i.id,
        filename: i.filename,
        fileType: i.fileType,
        importedAt: i.importedAt.toISOString(),
        totalRows: i.totalRows,
        successCount: i.successCount,
        errorCount: i.errorCount,
        janErrorCount: i.janErrorCount,
        unmapCount: i.unmapCount,
        importedBy: i.importer?.name ?? i.importedBy ?? null,
        note: i.note,
        result:
          i.errorCount > 0
            ? 'error'
            : i.unmapCount > 0
              ? 'warn'
              : 'ok',
      })),
    },
    message: 'OK',
  });
}
