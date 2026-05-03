import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import { staffMhReport } from '@/lib/reports';
import { parsePeriodFromUrl } from '@/lib/report-period';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const range = parsePeriodFromUrl(req);
  if ('error' in range) return range.error;
  const data = await staffMhReport(range.from, range.to);
  return NextResponse.json({ data: { items: data }, message: 'OK' });
}
