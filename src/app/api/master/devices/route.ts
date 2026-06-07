/**
 * GET  /api/master/devices   一覧
 * POST /api/master/devices   作成
 *
 * Sprint Y-9: デフォルトプリンタ（DevicePrinterMap）も併せて読み書き。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole, requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

// 空文字 → null
const nullableStr = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? null : v));

// Sprint Y-10: tablet / handy のみ受付。プリンタは別マスタ、PC は不要。
const Body = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(50),
  type: z.enum(['tablet', 'handy']),
  model: nullableStr(50),
  location: nullableStr(50),
  active: z.boolean().default(true),
  // Sprint Y-9: デフォルトプリンタ（任意）
  defaultPrinterCode: nullableStr(20),
});

export async function GET() {
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;
  const items = await prisma.device.findMany({
    orderBy: [{ active: 'desc' }, { type: 'asc' }, { code: 'asc' }],
    include: {
      // Sprint Y-9: デフォルトプリンタを結合表示
      printerMap: { include: { printer: { select: { code: true, name: true } } } },
    },
  });
  const out = items.map((d) => ({
    code: d.code,
    name: d.name,
    type: d.type,
    model: d.model,
    location: d.location,
    active: d.active,
    defaultPrinterCode: d.printerMap?.printer.code ?? null,
    defaultPrinterName: d.printerMap?.printer.name ?? null,
  }));
  return NextResponse.json({ data: { items: out }, message: 'OK' });
}

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    const detailed = parsed.error.issues
      .map((i) => {
        const path = (i.path ?? []).join('.') || '(body)';
        return `[${path}] ${i.message}`;
      })
      .join(' / ');
    return NextResponse.json(
      { error: 'VALIDATION', message: detailed || 'バリデーションエラー' },
      { status: 422 },
    );
  }

  // プリンタ存在チェック
  if (parsed.data.defaultPrinterCode) {
    const p = await prisma.printer.findUnique({
      where: { code: parsed.data.defaultPrinterCode },
      select: { code: true },
    });
    if (!p) {
      return NextResponse.json(
        {
          error: 'VALIDATION',
          message: `プリンタ「${parsed.data.defaultPrinterCode}」はプリンタマスタに存在しません`,
        },
        { status: 422 },
      );
    }
  }

  const { defaultPrinterCode, ...deviceFields } = parsed.data;
  try {
    // Sprint Y-10: 順次実行（互換性のため）
    const created = await prisma.device.create({ data: deviceFields });
    if (defaultPrinterCode) {
      await prisma.devicePrinterMap.create({
        data: {
          deviceCode: created.code,
          printerCode: defaultPrinterCode,
          updatedBy: guard.auth.staffCode ?? null,
        },
      });
    }
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json(
        { error: 'CONFLICT', message: `コード「${parsed.data.code}」は既に使用されています` },
        { status: 409 },
      );
    }
    return maskError(
      '[POST /api/master/devices]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました',
    );
  }
}
