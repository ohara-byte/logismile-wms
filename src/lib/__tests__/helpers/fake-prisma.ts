/**
 * Thomas 取込（csv-adapter / thomas-import）用の最小のメモリ上 prisma 代替。
 *
 * CI は DB を使わない（.github/workflows/ci.yml）。取込処理の「どの伝票を登録し、どれを落とすか」を
 * DB なしで固定するため、取込処理が呼ぶメソッドだけを持つ。
 */

type Row = Record<string, unknown>;

export function createFakePrisma(seed: {
  products?: { code: string; name: string }[];
  shippingOrders?: { pkNo: string }[];
  carrierAliases?: { aliasName: string; carrierCode: string; active?: boolean }[];
  qrForceKeywords?: { matchText: string; active?: boolean }[];
  /** shippingOrder.create で投げる例外（pkNo → 例外） */
  createErrors?: Record<string, unknown>;
} = {}) {
  const state = {
    products: [...(seed.products ?? [])] as Row[],
    shippingOrders: [...(seed.shippingOrders ?? [])] as Row[],
    alerts: [] as Row[],
    thomasImports: [] as Row[],
  };
  let importSeq = 0;

  const prisma = {
    thomasImport: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: ++importSeq, ...data };
        state.thomasImports.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: number }; data: Row }) => {
        const row = state.thomasImports.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    carrierAlias: {
      findMany: async () =>
        (seed.carrierAliases ?? []).filter((a) => a.active !== false),
    },
    qrForceKeyword: {
      findMany: async () =>
        (seed.qrForceKeywords ?? []).filter((k) => k.active !== false),
    },
    product: {
      findMany: async ({ where }: { where: { code: { in: string[] } } }) =>
        state.products.filter((p) => where.code.in.includes(p.code as string)),
      upsert: async ({ where, update, create }: { where: { code: string }; update: Row; create: Row }) => {
        const existing = state.products.find((p) => p.code === where.code);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        state.products.push({ ...create });
        return create;
      },
    },
    shippingOrder: {
      findMany: async ({ where }: { where: { pkNo: { in: string[] } } }) =>
        state.shippingOrders.filter((o) => where.pkNo.in.includes(o.pkNo as string)),
      create: async ({ data }: { data: Row & { pkNo: string } }) => {
        const err = seed.createErrors?.[data.pkNo];
        if (err) throw err;
        state.shippingOrders.push(data);
        return data;
      },
    },
    alert: {
      create: async ({ data }: { data: Row }) => {
        state.alerts.push(data);
        return data;
      },
      findFirst: async ({ where }: { where: Row }) =>
        state.alerts.find((a) => a.type === where.type && a.refCode === where.refCode) ?? null,
    },
  };

  return { prisma, state };
}
