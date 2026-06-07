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
    const msg = e instanceof Error ? e.message : String(e);
    // 想定済みの検証エラー（必須列不足など）はメッセージをそのまま返す
    if (msg.includes('必須列') || msg.includes('日付列')) {
      return NextResponse.json({ error: 'VALIDATION', message: msg }, { status: 422 });
    }
    return NextResponse.json(
      { error: 'INTERNAL', message: `GPシフトCSV のプレビュー処理に失敗しました: ${msg}` },
      { status: 500 },
    );
  }
}
