'use client';

/**
 * 伝票詳細モーダル（odModal）の Provider / Hook
 *
 * 任意の場所から useOrderDetailModal().open(pkNo) で開けるようにする。
 * モーダル本体は admin layout 配下にひとつだけ常設し、Provider が
 * pkNo state を保持する。
 */

import { createContext, useContext, useState } from 'react';
import { OrderDetailModal } from './order-detail-modal';

interface OrderDetailContextValue {
  open: (pkNo: string) => void;
  close: () => void;
  currentPkNo: string | null;
}

const Ctx = createContext<OrderDetailContextValue>({
  open: () => {},
  close: () => {},
  currentPkNo: null,
});

export function useOrderDetailModal(): OrderDetailContextValue {
  return useContext(Ctx);
}

export function OrderDetailProvider({ children }: { children: React.ReactNode }) {
  const [pkNo, setPkNo] = useState<string | null>(null);
  return (
    <Ctx.Provider
      value={{
        open: (n) => setPkNo(n),
        close: () => setPkNo(null),
        currentPkNo: pkNo,
      }}
    >
      {children}
      {pkNo && <OrderDetailModal pkNo={pkNo} onClose={() => setPkNo(null)} />}
    </Ctx.Provider>
  );
}
