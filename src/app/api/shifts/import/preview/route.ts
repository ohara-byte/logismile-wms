/**
 * POST /api/shifts/import/preview
 * GPシフトCSV のプレビュー（突合 / 検証）
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import { previewShiftCsv } from '@/lib/shift-import';

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'VALIDATION', message: 'file は必須' },
        { status: 422 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = await previewShiftCsv(buffer);
    return NextResponse.json({ data: preview, message: 'OK' });
  } catch (e) {
    return NextResponse.json(
      { error: 'INTERNAL', message: (e as Error).message },
      { status: 500 },
    );
  }
}
