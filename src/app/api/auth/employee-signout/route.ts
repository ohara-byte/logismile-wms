import { NextResponse } from 'next/server';
import { clearEmployeeSession, getEmployeeSession } from '@/lib/auth/employee-session';
import { prisma } from '@/lib/db';

/**
 * POST /api/auth/employee-signout — モバイル端末のログアウト
 *
 * Sprint Y-9: 端末ロックも併せて解除する。
 *   セッションが取れなくても 200 を返す（既にログアウト済みのケース）。
 */
export async function POST() {
  try {
    const sess = await getEmployeeSession();
    if (sess?.deviceCode && sess.staffCode) {
      // 自分が占有している端末のみ解除（他者がすでに引き継いでいる場合は触らない）
      await prisma.device.updateMany({
        where: { code: sess.deviceCode, activeStaffCode: sess.staffCode },
        data: {
          activeStaffCode: null,
          activeSince: null,
          lastSeen: new Date(),
        },
      });
    }
  } catch (e) {
    console.warn('[employee-signout] device unlock skipped:', e);
  }
  await clearEmployeeSession();
  return NextResponse.json({ message: 'OK' });
}
