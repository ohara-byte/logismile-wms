import { NextResponse } from 'next/server';
import { clearEmployeeSession } from '@/lib/auth/employee-session';

/** POST /api/auth/employee-signout — モバイル端末のログアウト */
export async function POST() {
  await clearEmployeeSession();
  return NextResponse.json({ message: 'OK' });
}
