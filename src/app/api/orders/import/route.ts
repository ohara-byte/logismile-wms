import { NextRequest, NextResponse } from 'next/server';
import { getDefaultAdapter } from '@/lib/integration/adapter';
import { detectFileType, parseCsv } from '@/lib/integration/csv-parser';
import { requireRole } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db';
import {
  allocateOrder,
  createDraftInstructionsFromShortages,
} from '@/lib/allocation/allocate-order';

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
    if (buffer.length > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'PAYLOAD_TOO_LARGE', message: 'CSV は 20MB 以下にしてください' },
        { status: 413 },
      );
    }
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

    // Sprint Z-1: 出荷指示取込完了後、自動引当を fire-and-forget で実行
    //   - 取込結果に影響しないよう、try/catch で握り潰す
    //   - 完了/未完了を問わず、対象の pkNo に対して allocateOrder を試行
    //   - 不足は draft の ManufacturingInstruction として集約（人手レビュー後に送信）
    if (fileType === 'orders') {
      const importedPkNos = await prisma.shippingOrder
        .findMany({
          where: {
            importId: (result as { importId?: number }).importId,
            deletedAt: null,
          },
          select: { pkNo: true },
        })
        .catch(() => [] as Array<{ pkNo: string }>);

      // 並列上限を抑えて順次処理（在庫競合の可能性を下げる）
      const allShortages: Array<{ productCode: string; shortageQty: number }> = [];
      for (const { pkNo } of importedPkNos) {
        try {
          const r = await allocateOrder(pkNo);
          for (const s of r.shortages) {
            const existing = allShortages.find((x) => x.productCode === s.productCode);
            if (existing) existing.shortageQty += s.shortageQty;
            else allShortages.push({ ...s });
          }
        } catch (e) {
          console.warn(`[allocate-on-import] ${pkNo}:`, e);
        }
      }

      if (allShortages.length > 0) {
        try {
          // Sprint Y-13: 取込時はアラートを生成しない（通過型運用で大量に出る不足は想定内のため）
          //   業務終了レポート時または手動再引当時にアラート化する
          await createDraftInstructionsFromShortages(allShortages, {
            requestedBy: guard.auth.staffCode ?? null,
            createAlerts: false,
          });
        } catch (e) {
          console.warn('[allocate-on-import] draft instructions failed:', e);
        }
      }
    }

    return NextResponse.json({ data: result, message: 'OK' });
  } catch (e) {
    console.error('[POST /api/orders/import]', e);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'CSV 取込処理中にサーバ内部エラーが発生しました' },
      { status: 500 },
    );
  }
}
