-- AlterTable
ALTER TABLE "shipping_orders" ADD COLUMN     "match_status" VARCHAR(10) NOT NULL DEFAULT 'none',
ADD COLUMN     "matched_at" TIMESTAMPTZ,
ADD COLUMN     "matched_by" VARCHAR(10);

-- CreateIndex
CREATE INDEX "shipping_orders_ship_date_match_status_idx" ON "shipping_orders"("ship_date", "match_status");
