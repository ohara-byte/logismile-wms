/**
 * GET  /api/mfg          製造指示一覧
 * POST /api/mfg          手動 draft 作成（任意・通常は自動生成）
 *
 * Sprint Z-3: 製造指示の管理エンドポイント
 *  - クエリ: status=draft|pending|sent|completed|cancelled / date=YYYY-MM-DD
 *  - 認証: admin/manager/lead は閲覧、admin/manager は新規作成
 *
 * Sprint Z-4: 検品ベースの状態派生（draft 内部を 検品前/検品中/検品済 に細分）
 *  - displayStatus: 'pre_inspection' | 'inspecting' | 'inspected' | 'sent' | 'completed' | 'cancelled'
 *  - クエリ: displayStatus / approved=true|false / productType も対応
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole, requirePermission } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';
import { parseDateAsUTC, addDaysUTC, todayJstAsUTC } from '@/lib/date-utils';

const Body = z.object({
  productCode: z.string().min(1).max(20),
  qty: z.number().int().min(1),
  shortageQty: z.number().int().min(0).optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().nullable().optional(),
});

export async function GET(req: Request) {
  // Sprint Y-15: lead もマスタ閲覧可
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const displayStatusFilter = searchParams.get('displayStatus'); // pre_inspection / inspecting / inspected / sent / completed / cancelled
  const approvedFilter = searchParams.get('approved'); // 'true' | 'false'
  const productTypeFilter = searchParams.get('productType'); // warehouse / pass_through / made_to_order
  const dateStr = searchParams.get('date');

  const where: Prisma.ManufacturingInstructionWhereInput = {};
  let dateRange: { gte: Date; lt: Date } | undefined;
  if (status) where.status = status;
  if (approvedFilter === 'true') where.approved = true;
  if (approvedFilter === 'false') where.approved = false;
  if (productTypeFilter) where.product = { productType: productTypeFilter };
  if (dateStr) {
    // 日付根治(2026-07-02): targetDate(@db.Date)は UTC 真夜中で照会。
    const d = parseDateAsUTC(dateStr);
    if (d) {
      dateRange = { gte: d, lt: addDaysUTC(d, 1) };
      where.targetDate = dateRange;
    }
  }

  const items = await prisma.manufacturingInstruction.findMany({
    where,
    orderBy: [{ status: 'asc' }, { targetDate: 'asc' }, { createdAt: 'desc' }],
    take: 100000, // 2026-06-04: 上限実質撤廃
    include: {
      product: {
        select: { name: true, jan: true, productType: true },
      },
    },
  });

  // 検品状態派生のため: 各 SKU について「対象日の引当 vs 必要数」「当日の在庫検品ログ」を集計
  const productCodes = Array.from(new Set(items.map((m) => m.productCode)));
  const targetDates = Array.from(
    new Set(items.map((m) => m.targetDate.toISOString().slice(0, 10))),
  );
  const allocBySkuDate = new Map<string, { reserved: number; fulfilled: number }>();
  const requiredBySkuDate = new Map<string, number>();
  const inspectionCountBySkuDate = new Map<string, number>();

  if (productCodes.length > 0 && targetDates.length > 0) {
    // 必要数の集計（出荷指示明細 group by productCode + shipDate）
    const tdRanges = targetDates.map((d) => {
      // 日付根治(2026-07-02): shipDate(@db.Date)は UTC、createdAt(タイムスタンプ)は JST 壁時計で照会。
      const utcStart = parseDateAsUTC(d) ?? todayJstAsUTC();
      const utcEnd = addDaysUTC(utcStart, 1);
      const jstStart = new Date(d);
      jstStart.setHours(0, 0, 0, 0);
      const jstEnd = new Date(jstStart);
      jstEnd.setDate(jstEnd.getDate() + 1);
      return { d, utcStart, utcEnd, jstStart, jstEnd };
    });

    // 必要数
    const orderItems = await prisma.shippingOrderItem.findMany({
      where: {
        productCode: { in: productCodes },
        order: {
          deletedAt: null,
          OR: tdRanges.map((r) => ({
            shipDate: { gte: r.utcStart, lt: r.utcEnd },
          })),
        },
      },
      select: {
        productCode: true,
        qty: true,
        order: { select: { shipDate: true } },
      },
    });
    for (const it of orderItems) {
      const dateKey = it.order.shipDate.toISOString().slice(0, 10);
      const k = `${it.productCode}__${dateKey}`;
      requiredBySkuDate.set(k, (requiredBySkuDate.get(k) ?? 0) + it.qty);
    }

    // 引当数
    const allocs = await prisma.allocation.findMany({
      where: {
        productCode: { in: productCodes },
        status: { not: 'released' },
        order: {
          deletedAt: null,
          OR: tdRanges.map((r) => ({
            shipDate: { gte: r.utcStart, lt: r.utcEnd },
          })),
        },
      },
      select: {
        productCode: true,
        qty: true,
        status: true,
        order: { select: { shipDate: true } },
      },
    });
    for (const a of allocs) {
      const dateKey = a.order.shipDate.toISOString().slice(0, 10);
      const k = `${a.productCode}__${dateKey}`;
      const ex = allocBySkuDate.get(k) ?? { reserved: 0, fulfilled: 0 };
      if (a.status === 'fulfilled') ex.fulfilled += a.qty;
      else ex.reserved += a.qty;
      allocBySkuDate.set(k, ex);
    }

    // 在庫検品ログ（type='inspection_count'）
    const movements = await prisma.stockMovement.findMany({
      where: {
        productCode: { in: productCodes },
        type: 'inspection_count',
        OR: tdRanges.map((r) => ({
          createdAt: { gte: r.jstStart, lt: r.jstEnd },
        })),
      },
      select: { productCode: true, createdAt: true },
    });
    for (const m of movements) {
      const dateKey = m.createdAt.toISOString().slice(0, 10);
      const k = `${m.productCode}__${dateKey}`;
      inspectionCountBySkuDate.set(k, (inspectionCountBySkuDate.get(k) ?? 0) + 1);
    }
  }

  function deriveDisplayStatus(
    raw: string,
    productCode: string,
    targetDate: string,
  ): 'pre_inspection' | 'inspecting' | 'inspected' | 'sent' | 'completed' | 'cancelled' {
    if (raw === 'sent') return 'sent';
    if (raw === 'completed') return 'completed';
    if (raw === 'cancelled') return 'cancelled';
    // draft / pending を 検品前 / 検品中 / 検品済 に派生
    const k = `${productCode}__${targetDate}`;
    const required = requiredBySkuDate.get(k) ?? 0;
    const alloc = allocBySkuDate.get(k) ?? { reserved: 0, fulfilled: 0 };
    const allocated = alloc.reserved + alloc.fulfilled;
    const inspections = inspectionCountBySkuDate.get(k) ?? 0;
    if (required > 0 && allocated >= required) return 'inspected';
    if (inspections > 0) return 'inspecting';
    return 'pre_inspection';
  }

  // 整形
  const out = items.map((m) => {
    const targetDate = m.targetDate.toISOString().slice(0, 10);
    const displayStatus = deriveDisplayStatus(m.status, m.productCode, targetDate);
    const k = `${m.productCode}__${targetDate}`;
    const required = requiredBySkuDate.get(k) ?? 0;
    const alloc = allocBySkuDate.get(k) ?? { reserved: 0, fulfilled: 0 };
    const allocated = alloc.reserved + alloc.fulfilled;
    const inspections = inspectionCountBySkuDate.get(k) ?? 0;
    return {
      id: m.id,
      instructionNo: m.instructionNo,
      productCode: m.productCode,
      productName: m.product.name,
      productJan: m.product.jan,
      productType: m.product.productType,
      qty: m.qty,
      shortageQty: m.shortageQty,
      status: m.status,
      displayStatus,
      approved: m.approved,
      required,
      allocated,
      inspections,
      targetDate,
      requestedBy: m.requestedBy,
      factoryRef: m.factoryRef,
      sentAt: m.sentAt?.toISOString() ?? null,
      completedAt: m.completedAt?.toISOString() ?? null,
      note: m.note,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  });

  // displayStatus フィルタ（client-side だと一覧と件数のずれが出るためここで適用）
  const filtered = displayStatusFilter
    ? out.filter((m) => m.displayStatus === displayStatusFilter)
    : out;

  // 表示用 summary（displayStatus 別 + 承認件数）
  const summary = {
    pre_inspection: 0,
    inspecting: 0,
    inspected: 0,
    sent: 0,
    completed: 0,
    cancelled: 0,
    approved: 0,
    unapproved: 0,
  };
  for (const m of out) {
    summary[m.displayStatus]++;
    if (
      m.displayStatus !== 'sent' &&
      m.displayStatus !== 'completed' &&
      m.displayStatus !== 'cancelled'
    ) {
      if (m.approved) summary.approved++;
      else summary.unapproved++;
    }
  }

  return NextResponse.json({
    data: {
      items: filtered,
      summary,
    },
    message: 'OK',
  });
}

export async function POST(req: Request) {
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

  // 商品の実在チェック
  const product = await prisma.product.findUnique({
    where: { code: parsed.data.productCode },
    select: { code: true },
  });
  if (!product) {
    return NextResponse.json(
      { error: 'VALIDATION', message: '商品コードが存在しません' },
      { status: 422 },
    );
  }

  try {
    // 採番
    const td = new Date(parsed.data.targetDate);
    const y = td.getFullYear();
    const m = String(td.getMonth() + 1).padStart(2, '0');
    const dd = String(td.getDate()).padStart(2, '0');
    const rand = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    const instructionNo = `MI-${y}${m}${dd}-${rand}`;

    const created = await prisma.manufacturingInstruction.create({
      data: {
        instructionNo,
        productCode: parsed.data.productCode,
        qty: parsed.data.qty,
        shortageQty: parsed.data.shortageQty ?? parsed.data.qty,
        status: 'draft',
        targetDate: td,
        requestedBy: guard.auth.staffCode ?? null,
        note: parsed.data.note ?? null,
      },
    });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    return maskError(
      '[POST /api/mfg]',
      e,
      'CONFLICT',
      409,
      '登録に失敗しました',
    );
  }
}
