/**
 * POST /api/shifts/import/execute
 * プレビューで生成した payload を shifts に upsert する。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/permissions';
import { executeShiftImport } from '@/lib/shift-import';

const Body = z.object({
  payload: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      staffCode: z.string().min(1),
      patternCode: z.string().min(1),
    }),
  ),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }

  const result = await executeShiftImport(parsed.data.payload);
  return NextResponse.json({ data: result, message: 'OK' });
}
