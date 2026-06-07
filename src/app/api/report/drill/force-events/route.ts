/**
 * GET /api/report/drill/force-events?from=&to=&reasonCode=&staffCode=
 * 強制OK分析 ドリルダウン（Sprint C-3）
 *
 * insp_logs (type='force_ok') を理由コード or 担当者でフィルタして
 * 個別 強制OK 発生イベントを返す。
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

  const { searchParams } = new URL(req.url);
  const staffCode = searchParams.get('staffCode') || undefined;
  const reasonCode = searchParams.get('reasonCode') || undefined;

  // note は "<reasonCode>:<reason text>" 形式で記録されている前提（API force/route.ts と整合）
  const logs = await prisma.inspLog.findMany({
    where: {
      type: 'force_ok',
      createdAt: { gte: from, lte: to },
      ...(reasonCode ? { note: { startsWith: reasonCode } } : {}),
      ...(staffCode ? { session: { staffCode } } : {}),
    },
    select: {
      itemCode: true,
      note: true,
      createdAt: true,
      session: {
        select: {
          staffCode: true,
          staff: { select: { name: true } },
          order: { select: { pkNo: true, destName: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100000, // 2026-06-04: 上限実質撤廃（ドリルダウンの取りこぼし防止）
  });

  const items = logs.map((l) => {
    // note: "R02: 商品不具合による差替" のような形式
    const noteStr = l.note ?? '';
    const m = noteStr.match(/^([A-Z0-9]+)\s*[:：]\s*(.+)$/);
    const code = m?.[1] ?? '';
    const reasonText = m?.[2] ?? noteStr;
    return {
      occurredAt: `${String(l.createdAt.getMonth() + 1).padStart(2, '0')}/${String(l.createdAt.getDate()).padStart(2, '0')} ${String(l.createdAt.getHours()).padStart(2, '0')}:${String(l.createdAt.getMinutes()).padStart(2, '0')}`,
      pkNo: l.session?.order?.pkNo ?? '—',
      destName: l.session?.order?.destName ?? '—',
      staffName: l.session?.staff?.name ?? '—',
      reasonCode: code,
      reasonText,
      itemCode: l.itemCode ?? '—',
    };
  });

  return NextResponse.json({ data: { items }, message: 'OK' });
}
