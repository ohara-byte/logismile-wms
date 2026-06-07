/**
 * PUT    /api/master/printers/[code]   更新
 * DELETE /api/master/printers/[code]   削除
 *
 * 削除は print_logs / device_printer_map の参照で失敗しやすい。
 * 実運用では active=false で論理停止を推奨。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const Body = z.object({
  name: z.string().min(1).max(50),
  ipAddress: z
    .string()
    .regex(IPV4_RE, 'IPv4 形式（例: 192.168.1.50）で入力してください'),
  port: z.number().int().min(1).max(65535).default(9100),
  model: z.string().max(50).default('SATO CT4-LX'),
  location: z.string().max(50).nullable().optional(),
  labelSize: z.string().max(20).default('30x40'),
  active: z.boolean().default(true),
  note: z.string().nullable().optional(),
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
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: parsed.error.issues.map((i) => i.message).join(', '),
      },
      { status: 422 },
    );
  }

  const code = decodeURIComponent(params.code);
  try {
    const updated = await prisma.printer.update({
      where: { code },
      data: parsed.data,
    });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'プリンタが見つかりません（IP 重複の可能性も）' },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { code: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const code = decodeURIComponent(params.code);
  try {
    await prisma.printer.delete({ where: { code } });
    return NextResponse.json({ data: { code }, message: 'OK' });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/printers]',
      e,
      'CONFLICT',
      409,
      '削除できません（印刷ログ／端末割当で参照中）。停止する場合は active=false を推奨します',
    );
  }
}
