-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "skill_coefficient" DECIMAL(4,3) NOT NULL DEFAULT 1.000,
ADD COLUMN     "skill_updated_at" TIMESTAMPTZ;
