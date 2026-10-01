import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { formatDateYmd, todayJstAsUTC } from '@/lib/date-utils';

/**
 * GET /api/health — サーバー稼働確認（認証不要）
 *
 * 未認証で叩けるため、内部例外メッセージは返さない。
 * 死活監視用に最小限の情報のみ。
 *
 * ★ businessDate / tz（2026-10-01）：
 *   コンテナのタイムゾーンが効いていないことに画面を開くまで気づけなかった
 *   事例が姉妹システム CraftSmile で発生したため追加（CraftSmile ADR-042）。
 *   businessDate はアプリが「今日」と思っている日本の暦日。日付計算は TZ 非依存
 *   なので設定に関係なく正しい値が出る。tz はログの時刻表示がどうなるかの参考。
 */
// 死活監視は常に「今」の状態を返す必要があるため prerender/キャッシュを禁止。
// 指定が無いと next build 時に静的評価され、DB 未接続のビルド環境で
// prisma:error がログに出る（ビルド自体は成功するがノイズになる）。
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      db: 'connected',
      businessDate: formatDateYmd(todayJstAsUTC()),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      time: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/health]', e);
    return NextResponse.json(
      {
        status: 'error',
        db: 'disconnected',
        time: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
