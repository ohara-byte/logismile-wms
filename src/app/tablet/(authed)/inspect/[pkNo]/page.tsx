/**
 * /tablet/inspect/[pkNo]
 * タブレット検品メイン画面（Phase 7-3 — モック準拠 UI）
 */

import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getEmployeeSession } from '@/lib/auth/employee-session';
import { TabletInspectionScreen } from './_components/tablet-inspection-screen';

export default async function InspectPage({
  params,
}: {
  params: { pkNo: string };
}) {
  const pkNo = decodeURIComponent(params.pkNo);

  const order = await prisma.shippingOrder.findFirst({
    where: { pkNo, deletedAt: null },
    include: {
      carrier: { select: { code: true, name: true, short: true, cool: true } },
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          product: { select: { code: true, name: true, jan: true, frozen: true, special: true } },
        },
      },
    },
  });
  if (!order) notFound();

  const session = await getEmployeeSession();

  return (
    <TabletInspectionScreen
      order={{
        id: order.id,
        pkNo: order.pkNo,
        status: order.status,
        qrPrintFlag: order.qrPrintFlag,
        invoiceNo: order.invoiceNo,
        noshiName: order.noshiName,
        destName: order.destName,
        destZip: order.destZip,
        destAddr: order.destAddr,
        carrier: order.carrier,
        items: order.items.map((it) => ({
          id: it.id,
          productCode: it.productCode,
          productName: it.productName,
          productJan: it.product.jan,
          productFrozen: it.product.frozen,
          qty: it.qty,
          scannedQty: it.scannedQty,
          forceOk: it.forceOk,
          forceReason: it.forceReason,
        })),
      }}
      employee={
        session
          ? {
              staffCode: session.staffCode,
              empCode: session.empCode,
              name: session.name,
              deviceCode: session.deviceCode,
            }
          : null
      }
    />
  );
}
