-- AlterTable
ALTER TABLE "BusinessOffering" ADD COLUMN     "alternatives" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "notFor" TEXT[];
