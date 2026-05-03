import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import { productAbcReport } from '@/lib/reports';
import { parsePeriodFromUrl } from '@/lib/report-period';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const range = parsePeriodFromUrl(req);
  if ('error' in range) return range.error;
  const { searchParams } = new URL(req.url);
  const top = Math.min(
    Math.max(parseInt(searchParams.get('top') ?? '30', 10) || 30, 1),
    500,
  );
  const data = await productAbcReport(range.from, range.to, top);
  return NextResponse.json({ data: { items: data }, message: 'OK' });
}
