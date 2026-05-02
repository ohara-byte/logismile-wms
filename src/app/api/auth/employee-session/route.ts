import { NextResponse } from 'next/server';
import { getEmployeeSession } from '@/lib/auth/employee-session';

/** GET /api/auth/employee-session — 現セッションの情報を返す（モバイル用） */
export async function GET() {
  const session = await getEmployeeSession();
  if (!session) {
    return NextResponse.json({ data: null, message: 'NO_SESSION' }, { status: 401 });
  }
  return NextResponse.json({
    data: {
      staffCode: session.staffCode,
      empCode: session.empCode,
      name: session.name,
      role: session.role,
      deviceCode: session.deviceCode,
      expiresAt: new Date(session.exp * 1000).toISOString(),
    },
  });
}
