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
    if (buffer.length > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'PAYLOAD_TOO_LARGE', message: 'GPシフトCSV は 5MB 以下にしてください' },
        { status: 413 },
      );
    }
    const preview = await previewShiftCsv(buffer);
    return NextResponse.json({ data: preview, message: 'OK' });
  } catch (e) {
    console.error('[POST /api/shifts/import/preview]', e);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'GPシフトCSV のプレビュー処理に失敗しました' },
      { status: 500 },
    );
  }
}
