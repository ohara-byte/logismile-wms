/**
 * POST /api/shifts/import/execute
 * プレビューで生成した payload を shifts に upsert する。
 *
 * Sprint J-2: createMissingStaff=true で未マッチ社員を自動登録してから取込する。
 *  - autoCreatableStaff を渡せばその情報で staff を upsert
 *  - 自動登録された社員のシフトも取り込みたい場合は file 経由（multipart）で
 *    POST して executeShiftImportFromBuffer を呼ぶ
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/permissions';
import {
  executeShiftImport,
  executeShiftImportFromBuffer,
} from '@/lib/shift-import';

const PayloadBody = z.object({
  payload: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      staffCode: z.string().min(1),
      patternCode: z.string().min(1),
    }),
  ),
  createMissingStaff: z.boolean().optional().default(false),
  autoCreatableStaff: z
    .array(
      z.object({
        empCode: z.string().min(1),
        name: z.string().min(1),
        employmentTypeCode: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const ctype = req.headers.get('content-type') ?? '';

  // 形式 1: multipart/form-data — file + flag を受け取って一括実行（自動登録社員も含めて取込）
  if (ctype.includes('multipart/form-data')) {
    try {
      const form = await req.formData();
      const file = form.get('file');
      const flag = String(form.get('createMissingStaff') ?? 'false') === 'true';
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: 'VALIDATION', message: 'file は必須' },
          { status: 422 },
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await executeShiftImportFromBuffer(buffer, {
        createMissingStaff: flag,
      });
      return NextResponse.json({ data: result, message: 'OK' });
    } catch (e) {
      console.error('[POST /api/shifts/import/execute multipart]', e);
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: 'INTERNAL', message: `取込に失敗しました: ${msg}` },
        { status: 500 },
      );
    }
  }

  // 形式 2（後方互換）: JSON で payload を受ける。createMissingStaff=true なら staff も upsert。
  const json = await req.json();
  const parsed = PayloadBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  try {
    const result = await executeShiftImport(parsed.data.payload, {
      createMissingStaff: parsed.data.createMissingStaff,
      autoCreatableStaff: parsed.data.autoCreatableStaff?.map((a) => ({
        empCode: a.empCode,
        name: a.name,
        employmentTypeCode: a.employmentTypeCode ?? null,
      })),
    });
    return NextResponse.json({ data: result, message: 'OK' });
  } catch (e) {
    console.error('[POST /api/shifts/import/execute]', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: 'INTERNAL', message: `取込に失敗しました: ${msg}` },
      { status: 500 },
    );
  }
}
