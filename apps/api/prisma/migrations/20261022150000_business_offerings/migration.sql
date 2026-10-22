-- CreateEnum
CREATE TYPE "OfferingKind" AS ENUM ('PRODUCT', 'SERVICE', 'PLAN', 'BUNDLE');

-- CreateEnum
CREATE TYPE "OfferingStatus" AS ENUM ('ACTIVE', 'SEASONAL', 'PAUSED', 'DISCONTINUED');

-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'BUSINESS_OFFERINGS_EXTRACT';

-- CreateTable
CREATE TABLE "BusinessOffering" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "kind" "OfferingKind" NOT NULL DEFAULT 'PRODUCT',
    "status" "OfferingStatus" NOT NULL DEFAULT 'ACTIVE',
    "push" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT NOT NULL DEFAULT '',
    "features" TEXT[],
    "priceAmount" DECIMAL(18,2),
    "priceCurrency" TEXT,
    "priceFrom" BOOLEAN NOT NULL DEFAULT false,
    "priceUnit" TEXT NOT NULL DEFAULT '',
    "priceValidUntil" TIMESTAMP(3),
    "availableFrom" TIMESTAMP(3),
    "availableUntil" TIMESTAMP(3),
    "url" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "source" "SectionSource" NOT NULL DEFAULT 'ADMIN',
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "evidence" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "jobId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessOffering_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessOffering_businessId_status_idx" ON "BusinessOffering"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOffering_businessId_name_key" ON "BusinessOffering"("businessId", "name");

-- AddForeignKey
ALTER TABLE "BusinessOffering" ADD CONSTRAINT "BusinessOffering_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessOffering" ADD CONSTRAINT "BusinessOffering_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

