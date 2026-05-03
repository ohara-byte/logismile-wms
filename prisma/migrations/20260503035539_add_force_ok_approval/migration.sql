-- AlterTable
ALTER TABLE "shipping_order_items" ADD COLUMN     "force_approval_status" VARCHAR(10),
ADD COLUMN     "force_approved_at" TIMESTAMPTZ,
ADD COLUMN     "force_approved_by" VARCHAR(10),
ADD COLUMN     "force_reason_code" VARCHAR(5),
ADD COLUMN     "force_reject_reason" TEXT;

-- CreateIndex
CREATE INDEX "shipping_order_items_force_ok_force_approval_status_idx" ON "shipping_order_items"("force_ok", "force_approval_status");
