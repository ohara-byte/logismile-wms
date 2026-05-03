-- AlterTable
ALTER TABLE "notices" ADD COLUMN     "ack_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "category" VARCHAR(10),
ADD COLUMN     "kind" VARCHAR(10) NOT NULL DEFAULT 'announce',
ADD COLUMN     "read_at" TIMESTAMPTZ,
ADD COLUMN     "read_by" VARCHAR(10),
ADD COLUMN     "sender_code" VARCHAR(10);

-- CreateIndex
CREATE INDEX "notices_kind_active_date_idx" ON "notices"("kind", "active", "date");

-- CreateIndex
CREATE INDEX "notices_kind_read_at_idx" ON "notices"("kind", "read_at");
