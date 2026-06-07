/**
 * PUT    /api/master/devices/[code]   更新（デフォルトプリンタも upsert）
 * DELETE /api/master/devices/[code]   削除（?force=true で関連レコードもカスケード）
 *
 * Sprint Y-9 / Y-10: device_printer_map / InspSession / PrintLog の参照解除
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const nullableStr = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? null : v));

const Body = z.object({
  name: z.string().min(1).max(50),
  type: z.enum(['tablet', 'handy']),
  model: nullableStr(50),
  location: nullableStr(50),
  active: z.boolean().default(true),
  defaultPrinterCode: nullableStr(20),
});

export async function PUT(
  req: Request,
  { params }: { params: { code: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const json = await req.json().catch(() => ({}));
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
  const code = decodeURIComponent(params.code);

  // 端末が存在するか先に確認（透明なエラーメッセージ）
  const existing = await prisma.device.findUnique({ where: { code } });
  if (!existing) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: `端末コード「${code}」は見つかりません` },
      { status: 404 },
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
    // Sprint Y-10: トランザクションを使わず順次実行（Prisma 5.x の interactive tx と
    //   .catch() の組み合わせで稀にハングするケースを回避）
    const updated = await prisma.device.update({
      where: { code },
      data: deviceFields,
    });

    if (defaultPrinterCode) {
      await prisma.devicePrinterMap.upsert({
        where: { deviceCode: code },
        create: {
          deviceCode: code,
          printerCode: defaultPrinterCode,
          updatedBy: guard.auth.staffCode ?? null,
        },
        update: {
          printerCode: defaultPrinterCode,
          updatedBy: guard.auth.staffCode ?? null,
        },
      });
    } else {
      // 未設定に戻す（既存マップがあれば削除）
      const existingMap = await prisma.devicePrinterMap.findUnique({
        where: { deviceCode: code },
      });
      if (existingMap) {
        await prisma.devicePrinterMap.delete({ where: { deviceCode: code } });
      }
    }

    return NextResponse.json({ data: updated, message: 'OK' });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025') {
        return NextResponse.json(
          { error: 'NOT_FOUND', message: 'コードが見つかりません' },
          { status: 404 },
        );
      }
      if (e.code === 'P2003') {
        return NextResponse.json(
          {
            error: 'VALIDATION',
            message: 'プリンタコードがマスタに存在しません',
          },
          { status: 422 },
        );
      }
    }
    return maskError(
      '[PUT /api/master/devices/[code]]',
      e,
      'INTERNAL',
      500,
      '更新に失敗しました',
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { code: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const code = decodeURIComponent(params.code);

  // Sprint Y-10: ?force=true で関連レコードを参照解除して削除
  const { searchParams } = new URL(req.url);
  const force = searchParams.get('force') === 'true';

  // 参照件数の確認
  const [inspSessionCount, printLogCount, stockAllocSessionCount, deviceMapCount] =
    await Promise.all([
      prisma.inspSession.count({ where: { deviceCode: code } }),
      prisma.printLog.count({ where: { deviceCode: code } }),
      prisma.stockAllocSession.count({ where: { deviceCode: code } }),
      prisma.devicePrinterMap.count({ where: { deviceCode: code } }),
    ]);

  // DevicePrinterMap は onDelete: Cascade なので参照ブロックにならない
  const blockingTotal = inspSessionCount + printLogCount + stockAllocSessionCount;

  if (blockingTotal > 0 && !force) {
    const parts: string[] = [];
    if (inspSessionCount) parts.push(`検品セッション ${inspSessionCount} 件`);
    if (printLogCount) parts.push(`印刷ログ ${printLogCount} 件`);
    if (stockAllocSessionCount)
      parts.push(`在庫検品セッション ${stockAllocSessionCount} 件`);
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `この端末は以下から参照されているため削除できません: ${parts.join(' / ')}\n（参照を解除して削除するには ?force=true）`,
        meta: {
          inspSessionCount,
          printLogCount,
          stockAllocSessionCount,
          deviceMapCount,
        },
      },
      { status: 409 },
    );
  }

  try {
    if (force && blockingTotal > 0) {
      // 任意 FK は nullify
      await prisma.inspSession.updateMany({
        where: { deviceCode: code },
        data: { deviceCode: null },
      });
      await prisma.printLog.updateMany({
        where: { deviceCode: code },
        data: { deviceCode: null },
      });
      // 必須 FK の StockAllocSession は削除
      await prisma.stockAllocSession.deleteMany({
        where: { deviceCode: code },
      });
    }
    await prisma.device.delete({ where: { code } });
    return NextResponse.json({
      data: {
        code,
        forced: force,
        unlinkedInspSessions: force ? inspSessionCount : 0,
        unlinkedPrintLogs: force ? printLogCount : 0,
        deletedStockAllocSessions: force ? stockAllocSessionCount : 0,
        cascadedPrinterMaps: deviceMapCount,
      },
      message: force
        ? `端末を削除しました（参照解除: 検品 ${inspSessionCount} / 印刷 ${printLogCount} / 在庫検品 ${stockAllocSessionCount}）`
        : 'OK',
    });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/devices]',
      e,
      'CONFLICT',
      409,
      '削除できません（予期しない参照あり）',
    );
  }
}
