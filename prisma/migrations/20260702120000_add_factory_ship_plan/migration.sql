-- FactoryShipPlan: クラフトスマイル連携（検品照合グリッド用）。
--   発送日ごとの 発送予定数(①)・18時確定数(②)・製造部署 のスナップショット受け皿。
CREATE TABLE "factory_ship_plans" (
    "id" TEXT NOT NULL,
    "ship_date" DATE NOT NULL,
    "product_code" VARCHAR(20) NOT NULL,
    "product_name" VARCHAR(100),
    "production_dept_code" VARCHAR(20),
    "production_dept_name" VARCHAR(40),
    "planned_qty" INTEGER NOT NULL DEFAULT 0,
    "confirmed_qty" INTEGER,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "factory_ship_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "factory_ship_plans_ship_date_product_code_key" ON "factory_ship_plans"("ship_date", "product_code");
CREATE INDEX "factory_ship_plans_ship_date_idx" ON "factory_ship_plans"("ship_date");
CREATE INDEX "factory_ship_plans_ship_date_production_dept_code_idx" ON "factory_ship_plans"("ship_date", "production_dept_code");
