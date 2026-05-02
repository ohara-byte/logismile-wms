import { NextRequest, NextResponse } from 'next/server';
import { getDefaultAdapter } from '@/lib/integration/adapter';
import { detectFileType, parseCsv } from '@/lib/integration/csv-parser';
import { requireRole } from '@/lib/auth/permissions';

/**
 * POST /api/orders/import
 * Thomas CSV 取込（IFアダプタ層経由）
 *
 * 権限: admin / manager のみ
 *
 * リクエスト: multipart/form-data
 *   - file: CSV ファイル
 *
 * 処理:
 *  1. 文字コード自動判定（Shift-JIS / UTF-8）
 *  2. ファイル種別判定（products / orders / sort）
 *  3. アダプタを呼び出し → DB 投入
 */
export async function POST(req: NextRequest) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'VALIDATION', message: 'file フィールドが必須です' },
        { status: 422 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name;

    // ヘッダだけ先に解析してファイル種別を判定
    const { headers } = parseCsv(buffer);
    const fileType = detectFileType(headers);

    const adapter = getDefaultAdapter();
    const ctx = { importedBy: guard.auth.staffCode ?? undefined };
    const result =
      fileType === 'products'
        ? await adapter.importProducts({ kind: 'csv', buffer, filename }, ctx)
        : fileType === 'orders'
          ? await adapter.importShippingOrders({ kind: 'csv', buffer, filename }, ctx)
          : null;

    if (!result) {
      return NextResponse.json(
        {
          error: 'VALIDATION',
          message: `CSV ファイル種別を判定できませんでした（headers: ${headers.join(', ')}）`,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ data: result, message: 'OK' });
  } catch (e) {
    console.error('[POST /api/orders/import]', e);
    return NextResponse.json(
      { error: 'INTERNAL', message: (e as Error).message },
      { status: 500 },
    );
  }
}
