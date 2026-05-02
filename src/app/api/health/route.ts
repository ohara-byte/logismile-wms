import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/health — サーバー稼働確認（認証不要）
 *
 * 未認証で叩けるため、内部例外メッセージは返さない。
 * 死活監視用に最小限の情報のみ。
 */
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
