/**
 * GET /api/auth/devices?type=tablet|handy
 *
 * 認証不要。ログイン画面の端末コード選択肢を取得するための公開エンドポイント。
 *
 * 返すデータは最小限（code/name/type/location/active/占有中フラグ）。
 *  - 機微情報は含めない
 *  - active=false（廃棄/停止）は除外
 *
 * Sprint Y-9: 重複ログイン防止のため `inUseBy` も併せて返す（社員氏名は伏せて empCode のみ可視化）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const SESSION_TIMEOUT_MIN = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  if (type && type !== 'tablet' && type !== 'handy') {
    return NextResponse.json(
      { error: 'VALIDATION', message: 'type は tablet / handy のみ指定可' },
      { status: 422 },
    );
  }

  const items = await prisma.device.findMany({
    where: {
      active: true,
      ...(type ? { type } : {}),
    },
    orderBy: [{ type: 'asc' }, { code: 'asc' }],
    select: {
      code: true,
      name: true,
      type: true,
      location: true,
      activeStaffCode: true,
      activeSince: true,
      lastSeen: true,
    },
  });

  // タイムアウト判定: lastSeen が SESSION_TIMEOUT_MIN 分以上前なら "解放可" とみなす
  const now = Date.now();
  const result = items.map((d) => {
    const lastSeenMs = d.lastSeen ? d.lastSeen.getTime() : null;
    const idleMin = lastSeenMs ? Math.round((now - lastSeenMs) / 60000) : null;
    const stale =
      d.activeStaffCode != null &&
      lastSeenMs != null &&
      now - lastSeenMs > SESSION_TIMEOUT_MIN * 60 * 1000;
    return {
      code: d.code,
      name: d.name,
      type: d.type,
      location: d.location,
      inUseBy: d.activeStaffCode, // 占有中の社員コード（null=空き）
      activeSince: d.activeSince ? d.activeSince.toISOString() : null,
      idleMin,
      stale, // タイムアウト超過 → 強制ログイン可能（クライアント側で警告表示）
    };
  });

  return NextResponse.json({
    data: { items: result, sessionTimeoutMin: SESSION_TIMEOUT_MIN },
    message: 'OK',
  });
}
