import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/** GET /api/health — サーバー稼働確認（認証不要） */
export async function GET() {
  try {
    // 軽い DB 接続確認
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      db: 'connected',
      time: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        status: 'error',
        db: 'disconnected',
        time: new Date().toISOString(),
        message: (e as Error).message,
      },
      { status: 500 },
    );
  }
}
