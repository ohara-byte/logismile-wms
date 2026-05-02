import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import { heatmapReport } from '@/lib/reports';

export async function GET(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to)
    return NextResponse.json(
      { error: 'VALIDATION', message: 'from / to は必須' },
      { status: 422 },
    );
  const data = await heatmapReport(new Date(from), new Date(to));
  return NextResponse.json({ data, message: 'OK' });
}
