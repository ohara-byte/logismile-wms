-- AlterTable: 熨斗氏名カラム追加
ALTER TABLE "shipping_orders" ADD COLUMN "noshi_person" VARCHAR(50);

-- CreateTable: のし確認 除外マスタ
CREATE TABLE "noshi_exclusions" (
    "id" SERIAL NOT NULL,
    "match_text" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "noshi_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "noshi_exclusions_match_text_key" ON "noshi_exclusions"("match_text");

-- CreateTable: QR印刷 強制マスタ
CREATE TABLE "qr_force_keywords" (
    "id" SERIAL NOT NULL,
    "match_text" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "qr_force_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qr_force_keywords_match_text_key" ON "qr_force_keywords"("match_text");
