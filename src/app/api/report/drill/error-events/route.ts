/**
 * GET /api/report/drill/error-events?from=&to=&staffCode=&kind=
 * 検品エラー率 ドリルダウン（Sprint C-2）
 *
 * insp_logs (type='scan' / note in [over_scan, not_found, already_done]) を
 * 担当者または結果区分でフィルタして個別エラー イベントを返す。
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parsePeriodFromUrl } from '@/lib/report-period';

const ERROR_KINDS = ['over_scan', 'not_found', 'already_done'] as const;

const RESULT_LABEL: Record<string, string> = {
  over_scan: '⚠ 数量超過',
  not_found: '✗ マスタ未登録',
  already_done: 'ℹ 既完了',
};

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const range = parsePeriodFromUrl(req);
  if ('error' in range) return range.error;
  const { from, to } = range;

  const { searchParams } = new URL(req.url);
  const staffCode = searchParams.get('staffCode') || undefined;
  const kindRaw = searchParams.get('kind');
  const kindFilter =
    kindRaw && (ERROR_KINDS as readonly string[]).includes(kindRaw)
      ? [kindRaw]
      : ERROR_KINDS;

  const logs = await prisma.inspLog.findMany({
    where: {
      type: 'scan',
      note: { in: kindFilter as string[] },
      createdAt: { gte: from, lte: to },
      ...(staffCode ? { session: { staffCode } } : {}),
    },
    select: {
      itemCode: true,
      qty: true,
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

  const items = logs.map((l) => ({
    occurredAt: `${String(l.createdAt.getMonth() + 1).padStart(2, '0')}/${String(l.createdAt.getDate()).padStart(2, '0')} ${String(l.createdAt.getHours()).padStart(2, '0')}:${String(l.createdAt.getMinutes()).padStart(2, '0')}`,
    pkNo: l.session?.order?.pkNo ?? '—',
    destName: l.session?.order?.destName ?? '—',
    staffName: l.session?.staff?.name ?? '—',
    kindLabel: RESULT_LABEL[l.note ?? ''] ?? l.note ?? '—',
    scanValue: l.itemCode ?? '—',
    qty: l.qty ?? 0,
  }));

  return NextResponse.json({ data: { items }, message: 'OK' });
}
