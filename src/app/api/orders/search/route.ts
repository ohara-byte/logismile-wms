/**
 * POST /api/orders/search
 * ミックス検索（A-08 検索タブ用）
 *
 * 14 種類のフィールドを AND で組み合わせ可能。
 * フラグチップ（待機/着手/完了/強制OK/冷凍/特殊梱包/前倒し/繰越/取消/all）でさらに絞り込む。
 *
 * リクエスト:
 *   {
 *     range: 'today' | 'tomorrow' | 'yesterday' | 'custom',
 *     customDate?: 'YYYY-MM-DD',
 *     conditions: Array<{ field: SearchField, value: string }>,
 *     flag: SearchFlag (default 'all'),
 *   }
 *
 * 応答:
 *   { items: SearchResult[], total: number }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { parseTableLetter } from '@/lib/pk-no';

const SEARCH_FIELDS = [
  'pk_no',
  'invoice_no',
  'customer',
  'customer_code',
  'tel',
  'product',
  'product_code',
  'component_name',
  'carrier',
  'noshi',
  'pref',
  'ship_date',
  'status',
  'table',
] as const;

const FLAGS = [
  'all',
  'wait',
  'working',
  'done',
  'alert',
  'cool',
  'special',
  'early',
  'carry',
  'cancel',
] as const;

const Body = z.object({
  range: z.enum(['today', 'tomorrow', 'yesterday', 'custom']).default('today'),
  customDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  conditions: z
    .array(
      z.object({
        field: z.enum(SEARCH_FIELDS),
        value: z.string().min(1),
      }),
    )
    .max(10)
    .default([]),
  flag: z.enum(FLAGS).default('all'),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION', message: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 422 },
    );
  }
  const { range, customDate, conditions, flag } = parsed.data;

  // 日付範囲
  const targetDate = computeTargetDate(range, customDate);
  const tomorrow = new Date(targetDate);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 各条件を Prisma where へ変換し AND 結合
  const conditionFilters: Prisma.ShippingOrderWhereInput[] = [];
  for (const c of conditions) {
    const w = mapCondition(c.field, c.value.trim());
    if (w) conditionFilters.push(w);
  }

  // フラグ → 追加フィルタ
  const flagFilter = mapFlag(flag);

  const where: Prisma.ShippingOrderWhereInput = {
    shipDate: { gte: targetDate, lt: tomorrow },
    // cancel フラグ以外は deletedAt=null（取消は deletedAt IS NOT NULL を見る）
    ...(flag === 'cancel' ? {} : { deletedAt: null }),
    AND: [
      ...conditionFilters,
      ...(flagFilter ? [flagFilter] : []),
    ],
  };

  const items = await prisma.shippingOrder.findMany({
    where,
    orderBy: [{ shipDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    include: {
      carrier: { select: { code: true, name: true, short: true, cool: true } },
      items: {
        select: {
          forceOk: true,
          forceReasonCode: true,
          product: { select: { frozen: true, special: true } },
        },
      },
      inspSession: {
        select: {
          startedAt: true,
          completedAt: true,
          staff: { select: { code: true, name: true } },
          device: { select: { code: true, location: true } },
        },
      },
    },
  });

  const total = items.length;

  const results = items.map((o) => {
    const hasForceOk = o.items.some((it) => it.forceOk);
    const hasFrozen = !!o.carrier?.cool || o.items.some((it) => it.product.frozen);
    const hasSpecial = o.items.some((it) => it.product.special);
    const flags: string[] = [];
    if (hasForceOk) flags.push('force_ok');
    if (hasFrozen) flags.push('cool');
    if (hasSpecial) flags.push('special');
    if (o.deletedAt) flags.push('cancel');

    const reasonCode = o.items.find((it) => it.forceOk)?.forceReasonCode ?? null;

    return {
      pkNo: o.pkNo,
      prefix: parsePkPrefix(o.pkNo),
      status: o.status,
      deleted: !!o.deletedAt,
      destName: o.destName,
      destAddr: o.destAddr,
      carrier: o.carrier
        ? {
            code: o.carrier.code,
            name: o.carrier.name,
            short: o.carrier.short,
            cool: o.carrier.cool,
          }
        : null,
      flags,
      forceReasonCode: reasonCode,
      inspStaff: o.inspSession?.staff
        ? {
            code: o.inspSession.staff.code,
            name: o.inspSession.staff.name,
          }
        : null,
      deviceLocation: o.inspSession?.device?.location ?? null,
      startedAt: o.inspSession?.startedAt?.toISOString() ?? null,
      completedAt: o.inspSession?.completedAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({
    data: {
      items: results,
      total,
      range,
      targetDate: targetDate.toISOString().slice(0, 10),
    },
    message: 'OK',
  });
}

// ──────────────────────────────────────────────
// 補助関数
// ──────────────────────────────────────────────

function computeTargetDate(
  range: 'today' | 'tomorrow' | 'yesterday' | 'custom',
  customDate?: string,
): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === 'today') return d;
  if (range === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (range === 'yesterday') {
    d.setDate(d.getDate() - 1);
    return d;
  }
  if (customDate) {
    const c = new Date(customDate);
    c.setHours(0, 0, 0, 0);
    return c;
  }
  return d;
}

function mapCondition(
  field: (typeof SEARCH_FIELDS)[number],
  value: string,
): Prisma.ShippingOrderWhereInput | null {
  const ci = { contains: value, mode: 'insensitive' as const };
  switch (field) {
    case 'pk_no':
      return { pkNo: ci };
    case 'invoice_no':
      return { invoiceNo: ci };
    case 'customer':
      return { destName: ci };
    case 'tel':
      // 電話フィールドは現在 schema 未対応 → destAddr に含まれる可能性で代用
      return { destAddr: ci };
    case 'product':
    case 'component_name':
      return {
        items: { some: { productName: ci } },
      };
    case 'product_code':
      return {
        items: { some: { productCode: ci } },
      };
    case 'carrier':
      return {
        carrier: { OR: [{ name: ci }, { short: ci }] },
      };
    case 'noshi':
      return { noshiName: ci };
    case 'pref':
    case 'customer_code':
      // 都道府県は destAddr 先頭に含まれる前提
      // customer_code は schema 未対応のため destAddr にフォールバック
      return { destAddr: ci };
    case 'ship_date': {
      // YYYY-MM-DD or YYYY/MM/DD or MM-DD（今年）を試行
      const m =
        value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/) ??
        value.match(/^(\d{1,2})[-/](\d{1,2})$/);
      if (!m) return null;
      const yyyy = m.length === 4 ? parseInt(m[1], 10) : new Date().getFullYear();
      const mm = parseInt(m[m.length - 2], 10);
      const dd = parseInt(m[m.length - 1], 10);
      const d = new Date(yyyy, mm - 1, dd);
      if (isNaN(d.getTime())) return null;
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      return { shipDate: { gte: d, lt: next } };
    }
    case 'status':
      // 「未着手」「検品中」「完了」等の和文も受ける
      return { status: { contains: normalizeStatusKw(value), mode: 'insensitive' } };
    case 'table':
      // テーブル情報は inspSession.device.location に近似で入る想定
      return {
        inspSession: {
          device: { location: ci },
        },
      };
    default:
      return null;
  }
}

function normalizeStatusKw(v: string): string {
  const t = v.trim();
  if (t === '未着手' || t === '待機') return 'pending';
  if (t === '検品中' || t === '着手中') return 'inspecting';
  if (t === '完了' || t === '梱包完了') return 'packed';
  if (t === '出荷済') return 'shipped';
  if (t === '保留') return 'held';
  return t;
}

function mapFlag(
  flag: (typeof FLAGS)[number],
): Prisma.ShippingOrderWhereInput | null {
  switch (flag) {
    case 'all':
      return null;
    case 'wait':
      return { status: 'pending' };
    case 'working':
      return { status: 'inspecting' };
    case 'done':
      return { status: { in: ['packed', 'shipped'] } };
    case 'alert':
      return { items: { some: { forceOk: true } } };
    case 'cool':
      return {
        OR: [
          { carrier: { cool: true } },
          { items: { some: { product: { frozen: true } } } },
        ],
      };
    case 'special':
      return { items: { some: { product: { special: true } } } };
    case 'cancel':
      return { deletedAt: { not: null } };
    case 'early':
    case 'carry':
      // 前倒し / 繰越 は schema 拡張前のため現状は無条件で空ヒット
      // 将来 ShippingOrder.early_flag / carry_flag を追加して対応
      return { id: '__never__' };
    default:
      return null;
  }
}

// テーブル記号（先頭 `S` 固定プレフィックスをスキップした 2 文字目 A〜Z）
// 旧仕様（先頭 2-4 文字を前方一致）から `S` + アルファベット 1 文字 + 数字 形式へ修正
function parsePkPrefix(pkNo: string): string | null {
  return parseTableLetter(pkNo);
}
