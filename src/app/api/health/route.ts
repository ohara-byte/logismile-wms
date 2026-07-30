import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/health — サーバー稼働確認（認証不要）
 *
 * 未認証で叩けるため、内部例外メッセージは返さない。
 * 死活監視用に最小限の情報のみ。
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
