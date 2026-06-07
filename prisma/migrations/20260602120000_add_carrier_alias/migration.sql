-- CreateTable
CREATE TABLE "carrier_aliases" (
    "id" SERIAL NOT NULL,
    "alias_name" VARCHAR(100) NOT NULL,
    "carrier_code" VARCHAR(20) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "carrier_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carrier_aliases_alias_name_key" ON "carrier_aliases"("alias_name");

-- CreateIndex
CREATE INDEX "carrier_aliases_carrier_code_idx" ON "carrier_aliases"("carrier_code");

-- AddForeignKey
ALTER TABLE "carrier_aliases" ADD CONSTRAINT "carrier_aliases_carrier_code_fkey" FOREIGN KEY ("carrier_code") REFERENCES "carriers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
