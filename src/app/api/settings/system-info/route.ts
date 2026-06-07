/**
 * GET /api/settings/system-info
 *
 * Sprint Z-5: 設定タブ用システム情報。
 *  - DRY-RUN フラグ群
 *  - DB 簡易ステータス
 *  - 現在のセッション数
 *  - 在庫サマリ（合計 SKU / 在庫数 / 引当合計）
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import {
  getFactoryMode,
  getFactoryWebhookSecret,
} from '@/lib/integration/factory-mode';

export async function GET() {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;

  const [activeInspSessions, todayMfgCount, stocksAgg] = await Promise.all([
    prisma.inspSession.count({ where: { completedAt: null } }),
    prisma.manufacturingInstruction.count({
      where: {
        targetDate: {
          gte: (() => {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            return d;
          })(),
          lt: (() => {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + 1);
            return d;
          })(),
        },
      },
    }),
    prisma.stock.aggregate({
      _count: { _all: true },
      _sum: { qty: true, allocatedQty: true },
    }),
  ]);

  return NextResponse.json({
    data: {
      env: {
        nodeEnv: process.env.NODE_ENV ?? 'unknown',
        factoryDryRun: (process.env.FACTORY_DRY_RUN ?? 'true') === 'true',
        printerDryRun: (process.env.PRINTER_DRY_RUN ?? 'false') === 'true',
        factoryBaseUrl: process.env.FACTORY_BASE_URL ?? '(unset)',
        // Sprint Z-8: 工場連携モード
        factoryIntegrationMode: getFactoryMode(),
        factoryWebhookSecretConfigured: getFactoryWebhookSecret() !== null,
      },
      activeInspSessions,
      todayMfgCount,
      stocks: {
        skuCount: stocksAgg._count._all ?? 0,
        totalQty: stocksAgg._sum.qty ?? 0,
        totalAllocatedQty: stocksAgg._sum.allocatedQty ?? 0,
      },
      now: new Date().toISOString(),
    },
    message: 'OK',
  });
}
