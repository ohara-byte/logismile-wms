/**
 * GET /api/integration/factory/health
 *
 * Sprint Z-8: 工場連携 疎通確認エンドポイント。
 *  - 認証なし（モード状態を返すため）
 *  - 製造システム側のヘルスモニタが定期 GET する想定
 *
 * 詳細は デスクトップ「WMS_工場連携IF仕様書_v0.1.md」§3-1 参照。
 */

import { NextResponse } from 'next/server';
import { getFactoryMode } from '@/lib/integration/factory-mode';

export async function GET() {
  return NextResponse.json({
    data: {
      wmsVersion: 'z-8',
      mode: getFactoryMode(),
      serverTime: new Date().toISOString(),
    },
    message: 'OK',
  });
}
