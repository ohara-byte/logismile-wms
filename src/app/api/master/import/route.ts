/**
 * POST /api/master/import   基幹(Thomas)マスタ取込（2026-06-22）
 *
 * 権限: admin / manager。multipart/form-data:
 *   - type: 'box_master' | 'jan_bridge' | 'comp_size' | 'bom' | 'set_time'
 *   - file: xlsx / csv
 *
 * 応答: 取込サマリ＋未結合行のプレビュー＋未結合CSV（そのままDLして人手補正に使う）。
 * 取込順の推奨: box_master → jan_bridge → comp_size → bom → set_time
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';
import type { ImportReport } from '@/lib/master-import/report';
import { reconciliationCsv, writeImportAudit } from '@/lib/master-import/report';
import { importBoxes } from '@/lib/master-import/box-import';
import { importJanBridge } from '@/lib/master-import/jan-bridge-import';
import { importComponentSizes } from '@/lib/master-import/component-size-import';
import { importBom } from '@/lib/master-import/bom-import';
import { importSetTimes } from '@/lib/master-import/set-time-import';

type ImportType = 'box_master' | 'jan_bridge' | 'comp_size' | 'bom' | 'set_time';

const IMPORTERS: Record<ImportType, (buf: Buffer, filename: string) => Promise<ImportReport>> = {
  box_master: importBoxes,
  jan_bridge: importJanBridge,
  comp_size: importComponentSizes,
  bom: importBom,
  set_time: importSetTimes,
};

export async function POST(req: NextRequest) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  try {
    const form = await req.formData();
    const type = String(form.get('type') ?? '') as ImportType;
    const file = form.get('file');
    if (!IMPORTERS[type]) {
      return NextResponse.json(
        { error: 'VALIDATION', message: 'type が不正です' },
        { status: 422 },
      );
    }
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'VALIDATION', message: 'file フィールドが必須です' },
        { status: 422 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > 30 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'PAYLOAD_TOO_LARGE', message: 'ファイルは 30MB 以下にしてください' },
        { status: 413 },
      );
    }

    const report = await IMPORTERS[type](buffer, file.name);
    await writeImportAudit(report, guard.auth.staffCode ?? null);

    return NextResponse.json({
      data: {
        type,
        filename: report.filename,
        totalRows: report.totalRows,
        imported: report.imported,
        skipped: report.skipped,
        unmatched: report.unmatched,
        warnings: report.warnings.slice(0, 50),
        unmatchedSample: report.unmatchedRows.slice(0, 20),
        unmatchedCsv: reconciliationCsv(report.unmatchedRows),
      },
      message: 'OK',
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'IMPORT_FAILED', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
