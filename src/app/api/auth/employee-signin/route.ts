/**
 * POST /api/auth/employee-signin
 * タブレット / ハンディ用ログイン（社員番号のみ）
 *
 * 処理:
 *  1. ★ 社内 IP 制限（INTRANET_CIDR_LIST）
 *  2. ★ レート制限（emp_code + IP の両方で）
 *  3. staff.emp_code で staff 検索（active=true）
 *  4. devices.code で device 検索
 *  5. device_printer_map から既定プリンターを取得（任意）
 *  6. 署名 Cookie をセット
 *
 * セキュリティ要件:
 *  - 入力値（device_code 等）をエラーメッセージに反射しない
 *  - 社員番号 / 端末コードの存在判別を timing で漏らさない
 *  - 失敗試行は emp_code・IP の両方でレート制限
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { setEmployeeSession, type EmployeeRole } from '@/lib/auth/employee-session';
import { clientIpFromHeaders, isIntranetIp } from '@/lib/auth/intranet';
import { isLocked, recordFailure, clearFailures } from '@/lib/auth/rate-limit';

const Body = z.object({
  emp_code: z.string().min(1, 'emp_code は必須です'),
  device_code: z.string().min(1, 'device_code は必須です'),
});

export async function POST(req: NextRequest) {
  // 1. 社内 IP 制限
  const ip = clientIpFromHeaders(req.headers);
  if (!isIntranetIp(ip)) {
    return NextResponse.json(
      { error: 'FORBIDDEN', message: '社内ネットワークからのみアクセス可能です' },
      { status: 403 },
    );
  }

  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 422 },
      );
    }
    const { emp_code, device_code } = parsed.data;

    // 2. レート制限（emp_code と IP の両方を見る）
    const empKey = `emp:${emp_code}`;
    const ipKey = `ip:${ip}`;
    const empLock = isLocked(empKey);
    const ipLock = isLocked(ipKey);
    if (empLock.locked || ipLock.locked) {
      const retry = Math.max(empLock.retryAfterSec ?? 0, ipLock.retryAfterSec ?? 0);
      return NextResponse.json(
        {
          error: 'TOO_MANY_REQUESTS',
          message: `試行回数を超過しました。${Math.ceil(retry / 60)} 分後に再試行してください`,
        },
        { status: 429, headers: { 'Retry-After': String(retry) } },
      );
    }

    // 3-5. 認証
    const staff = await prisma.staff.findUnique({
      where: { empCode: emp_code },
      select: { code: true, empCode: true, name: true, role: true, active: true, groupId: true },
    });
    if (!staff || !staff.active) {
      recordFailure(empKey);
      recordFailure(ipKey);
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: '社員番号または端末コードが無効です' },
        { status: 401 },
      );
    }

    const device = await prisma.device.findUnique({
      where: { code: device_code },
      select: { code: true, type: true, name: true, active: true },
    });
    if (!device || !device.active) {
      recordFailure(empKey);
      recordFailure(ipKey);
      // 入力値を反射しない（XSS / 列挙対策）
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: '社員番号または端末コードが無効です' },
        { status: 401 },
      );
    }

    // 既定プリンター（紐付けがあれば返す。なくてもログインは成功）
    const printerMap = await prisma.devicePrinterMap.findUnique({
      where: { deviceCode: device.code },
      include: { printer: { select: { code: true, ipAddress: true, port: true, model: true } } },
    });

    await setEmployeeSession({
      staffCode: staff.code,
      empCode: staff.empCode,
      name: staff.name,
      role: staff.role as EmployeeRole,
      deviceCode: device.code,
    });

    // 6. 成功時はカウンタをクリア
    clearFailures(empKey);
    clearFailures(ipKey);

    return NextResponse.json({
      data: {
        staff: {
          code: staff.code,
          emp_code: staff.empCode,
          name: staff.name,
          role: staff.role,
          group_id: staff.groupId,
        },
        device: { code: device.code, type: device.type, name: device.name },
        default_printer: printerMap?.printer ?? null,
      },
      message: 'OK',
    });
  } catch (e) {
    console.error('[POST /api/auth/employee-signin]', e);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'サーバ内部エラー' },
      { status: 500 },
    );
  }
}
