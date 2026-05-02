/**
 * POST /api/auth/employee-signin
 * タブレット / ハンディ用ログイン（社員番号のみ）
 *
 * リクエスト: { emp_code: string, device_code: string }
 *
 * 処理:
 *  1. staff.emp_code で staff 検索（active=true）
 *  2. devices.code で device 検索
 *  3. device_printer_map から既定プリンターを取得（任意）
 *  4. 署名 Cookie をセット
 *
 * TODO(社内IP制限): middleware で /api/auth/employee-signin を社内ネットワーク限定にする
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { setEmployeeSession, type EmployeeRole } from '@/lib/auth/employee-session';

const Body = z.object({
  emp_code: z.string().min(1, 'emp_code は必須です'),
  device_code: z.string().min(1, 'device_code は必須です'),
});

export async function POST(req: NextRequest) {
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

    const staff = await prisma.staff.findUnique({
      where: { empCode: emp_code },
      select: { code: true, empCode: true, name: true, role: true, active: true, groupId: true },
    });
    if (!staff || !staff.active) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: '社員番号が無効です' },
        { status: 401 },
      );
    }

    const device = await prisma.device.findUnique({
      where: { code: device_code },
      select: { code: true, type: true, name: true, active: true },
    });
    if (!device || !device.active) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: `端末コードが無効です: ${device_code}` },
        { status: 404 },
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
      { error: 'INTERNAL', message: (e as Error).message },
      { status: 500 },
    );
  }
}
