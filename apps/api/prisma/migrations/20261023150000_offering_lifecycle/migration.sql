-- CreateEnum
CREATE TYPE "OfferingStock" AS ENUM ('IN_STOCK', 'LOW', 'OUT');

-- AlterTable
ALTER TABLE "BusinessOffering" ADD COLUMN "stock" "OfferingStock" NOT NULL DEFAULT 'IN_STOCK',
ADD COLUMN "peakMonths" INTEGER[],
ADD COLUMN "complementIds" TEXT[],
ADD COLUMN "substituteIds" TEXT[];
