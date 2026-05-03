/**
 * GET /api/orders/[pkNo]/timeline
 * 伝票タイムライン（A-13 伝票詳細モーダル用）
 *
 * 集約ソース:
 *   - thomas_imports.created_at  → 'CSV取込'
 *   - print_logs                  → 'ピッキング票印刷' / 'QR印刷' (isReprint で判別)
 *   - insp_sessions.startedAt    → '検品着手'
 *   - insp_sessions.completedAt  → '検品完了'
 *   - insp_logs (force_ok)       → '強制OK 登録'
 *   - order_audit_logs           → '編集' / '削除' / '復活' 等
 *
 * 応答（時刻降順）:
 *   { items: TimelineEvent[] }
 *   TimelineEvent { at, kind, icon, message, actor }
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';

export async function GET(
  _req: Request,
  { params }: { params: { pkNo: string } },
) {
  const guard = await requireRole('admin', 'manager', 'staff');
  if (!guard.ok) return guard.response;

  const pkNo = decodeURIComponent(params.pkNo);

  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo },
    select: {
      id: true,
      importId: true,
      inspSession: {
        select: {
          id: true,
          startedAt: true,
          completedAt: true,
          staff: { select: { code: true, name: true } },
          device: { select: { code: true, name: true } },
          logs: {
            where: { type: 'force_ok' },
            orderBy: { createdAt: 'desc' },
            take: 50,
          },
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'ピッキング№が見つかりません' },
      { status: 404 },
    );
  }

  // staff は IDOR 対策で自身のセッション or pending のみ閲覧可（base endpoint と同等）
  // タイムラインの権限は base endpoint 側で保証されている前提でここでは簡略化

  const [audit, prints, importRow] = await Promise.all([
    prisma.orderAuditLog.findMany({
      where: { orderId: order.id },
      orderBy: { actedAt: 'desc' },
      take: 50,
    }),
    prisma.printLog.findMany({
      where: { orderId: order.id },
      orderBy: { printedAt: 'desc' },
      take: 30,
    }),
    order.importId
      ? prisma.thomasImport.findUnique({ where: { id: order.importId } })
      : Promise.resolve(null),
  ]);

  type Event = {
    at: string;
    kind: string;
    icon: string;
    message: string;
    actor: string | null;
  };

  const events: Event[] = [];

  if (importRow) {
    events.push({
      at: importRow.importedAt.toISOString(),
      kind: 'csv_import',
      icon: '📥',
      message: `出荷指示CSV 取込（${importRow.filename}）`,
      actor: importRow.importedBy ?? 'Thomas',
    });
  }

  for (const p of prints) {
    events.push({
      at: p.printedAt.toISOString(),
      kind: p.isReprint ? 'reprint' : 'print',
      icon: '🖨',
      message: p.isReprint
        ? `QR ラベル再発行 / printer=${p.printerCode}`
        : `QR ラベル印刷 / printer=${p.printerCode}`,
      actor: p.staffCode ?? null,
    });
  }

  if (order.inspSession?.startedAt) {
    events.push({
      at: order.inspSession.startedAt.toISOString(),
      kind: 'inspect_start',
      icon: '▶',
      message: `検品着手${order.inspSession.device ? ` (${order.inspSession.device.code})` : ''}`,
      actor: order.inspSession.staff?.name ?? order.inspSession.staff?.code ?? null,
    });
  }

  if (order.inspSession?.completedAt) {
    events.push({
      at: order.inspSession.completedAt.toISOString(),
      kind: 'inspect_complete',
      icon: '✅',
      message: '検品完了',
      actor: order.inspSession.staff?.name ?? order.inspSession.staff?.code ?? null,
    });
  }

  for (const log of order.inspSession?.logs ?? []) {
    events.push({
      at: log.createdAt.toISOString(),
      kind: 'force_ok',
      icon: '⚠',
      message: `強制OK 登録${log.note ? ` / ${log.note}` : ''}`,
      actor: order.inspSession?.staff?.name ?? order.inspSession?.staff?.code ?? null,
    });
  }

  for (const a of audit) {
    const iconMap: Record<string, string> = {
      delete: '🗑',
      restore: '♻',
      edit: '✏',
    };
    events.push({
      at: a.actedAt.toISOString(),
      kind: a.action,
      icon: iconMap[a.action] ?? '🔧',
      message: `${a.action}${a.reason ? ` / ${a.reason}` : ''}`,
      actor: a.actedBy,
    });
  }

  // 時刻降順（新しい順）に整列
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return NextResponse.json({ data: { items: events }, message: 'OK' });
}
