-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "pillarId" TEXT;

-- CreateTable
CREATE TABLE "ContentPillar" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetShare" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPillar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentPillar_businessId_order_idx" ON "ContentPillar"("businessId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPillar_businessId_name_key" ON "ContentPillar"("businessId", "name");

-- CreateIndex
CREATE INDEX "Content_pillarId_idx" ON "Content"("pillarId");

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "ContentPillar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPillar" ADD CONSTRAINT "ContentPillar_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

