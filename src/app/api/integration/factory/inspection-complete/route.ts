/**
 * POST /api/integration/factory/inspection-complete
 *
 * 2026-06-01 依頼 B2: WMS → 製造システムへ「検品完了」Webhook を送信する。
 *
 * 当面は **管理者手動トリガ**（疎通テスト用）。
 *   - 工場納品の受入検品フローが確定したら、その完了処理から
 *     notifyInspectionComplete() を内部呼び出しに置き換える想定。
 *   - admin / manager のみ実行可。
 *
 * リクエスト body は製造側が期待する検品完了 payload と同形:
 *   { deliveryNo, inspectedAt, inspectedBy, items:[{productCode, qtyDeclared, qtyInspected, qtyDiff, diffReason?, diffNote?}] }
 *
 * 実送信は FACTORY_DRY_RUN=false かつ FACTORY_OUTBOUND_HMAC_SECRET / FACTORY_BASE_URL 設定時のみ。
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/permissions';
import { isFactoryApiMode } from '@/lib/integration/factory-mode';
import { notifyInspectionComplete } from '@/lib/integration/factory-notify';

const Body = z.object({
  deliveryNo: z.string().min(1).max(30),
  inspectedAt: z.string().datetime({ offset: true }),
  inspectedBy: z.string().min(1).max(50),
  items: z
    .array(
      z.object({
        productCode: z.string().min(1).max(20),
        qtyDeclared: z.number().int().min(0),
        qtyInspected: z.number().int().min(0),
        qtyDiff: z.number().int(),
        diffReason: z.string().max(50).nullable().optional(),
        diffNote: z.string().max(500).nullable().optional(),
      }),
    )
    .min(1),
});

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  if (!isFactoryApiMode()) {
    return NextResponse.json(
      {
        data: null,
        message: '工場連携モードが有効ではありません（FACTORY_INTEGRATION_MODE=factory_api）',
        error: 'MODE_DISABLED',
      },
      { status: 503 },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        message: parsed.error.issues.map((i) => i.message).join(', '),
        error: 'VALIDATION',
      },
      { status: 422 },
    );
  }

  const result = await notifyInspectionComplete(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { data: null, message: result.message, error: 'NOTIFY_FAILED' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    data: {
      deliveryNo: parsed.data.deliveryNo,
      dryRun: result.dryRun,
      status: result.status ?? null,
      additionalDeliveryRequired: result.additionalDeliveryRequired ?? null,
    },
    message: result.dryRun ? 'DRY-RUN（実送信なし）' : 'OK',
  });
}
