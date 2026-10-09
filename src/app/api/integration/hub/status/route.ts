/**
 * POST /api/integration/hub/status
 *
 * HUB ← LogiSmile 梱包状況（2026-10-09・小原様「取りに行く方法で」「3 分」）。
 * HUB がピッキング№をまとめて送り、伝票ごとの状態（未着手・検品中・梱包済・出荷済・保留・削除）を返す。
 * **読むだけ**。送付先の氏名・住所は返さない。本体は hub-status.ts（テストで固定）。
 *
 * 認証：HMAC-SHA256（X-Hub-Signature / X-Hub-Timestamp）＋ Idempotency-Key・鍵 HUB_TO_WMS_SECRET。
 * HUB_INTEGRATION_ENABLED=true のときだけ有効（既定は 503）。
 */

import { prisma } from '@/lib/db';
import { getHubInboundSecret, isHubIntegrationEnabled } from '@/lib/integration/hub-auth';
import { handleHubStatus } from '@/lib/integration/hub-status';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleHubStatus(req, {
    enabled: isHubIntegrationEnabled(),
    secret: getHubInboundSecret(),
    findOrders: async (pkNos) => {
      const rows = await prisma.shippingOrder.findMany({
        where: { pkNo: { in: pkNos } },
        select: {
          pkNo: true, status: true, holdReason: true, deletedAt: true, updatedAt: true,
          inspSession: { select: { completedAt: true } },
        },
      });
      return rows.map((r) => ({
        pkNo: r.pkNo, status: r.status, holdReason: r.holdReason, deletedAt: r.deletedAt, updatedAt: r.updatedAt,
        packedAt: r.inspSession?.completedAt ?? null,
      }));
    },
  });
}
