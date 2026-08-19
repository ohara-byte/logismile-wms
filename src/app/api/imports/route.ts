import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

/** GET /api/imports — 取込履歴一覧（admin/manager のみ） */
export async function GET(req: NextRequest) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);

  const items = await prisma.thomasImport.findMany({
    orderBy: { importedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      filename: true,
      fileType: true,
      importedAt: true,
      totalRows: true,
      successCount: true,
      errorCount: true,
      janErrorCount: true,
      unmapCount: true,
      importedBy: true,
      // 2026-08-19（現場要望）：取込エラーの理由を画面から追えるようにする。
      //   従来は note に日本語で保存していたが select されておらず、
      //   どの画面からも見られないため「取込エラーの理由が不明」になっていた。
      note: true,
    },
  });

  return NextResponse.json({ data: { items }, message: 'OK' });
}
