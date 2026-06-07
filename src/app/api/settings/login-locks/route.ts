/**
 * GET    /api/settings/login-locks       — 現在のレート制限バケット一覧
 * POST   /api/settings/login-locks       — { key } で個別解除 / { all: true } で全解除
 *
 * Sprint Z-5: ログイン強制解除 UI 用。admin/manager のみ。
 *  - in-memory レート制限のため、再起動で消える点はリスクとして許容
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/permissions';
import {
  listBuckets,
  clearFailures,
  clearAllBuckets,
} from '@/lib/auth/rate-limit';

export async function GET() {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const buckets = listBuckets();
  // ロックされているもの先頭、次に試行回数の多い順
  buckets.sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? -1 : 1;
    return b.attempts - a.attempts;
  });
  return NextResponse.json({
    data: { buckets, total: buckets.length, lockedCount: buckets.filter((b) => b.locked).length },
    message: 'OK',
  });
}

const Body = z.object({
  key: z.string().min(1).optional(),
  all: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success || (!parsed.data.key && !parsed.data.all)) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: 'key もしくは all=true を指定してください',
      },
      { status: 422 },
    );
  }

  if (parsed.data.all) {
    const cleared = clearAllBuckets();
    return NextResponse.json({
      data: { cleared },
      message: `${cleared} 件のロックを解除しました`,
    });
  }

  clearFailures(parsed.data.key!);
  return NextResponse.json({
    data: { key: parsed.data.key },
    message: 'ロックを解除しました',
  });
}
