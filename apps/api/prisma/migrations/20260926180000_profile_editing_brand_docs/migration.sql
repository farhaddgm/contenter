-- CreateEnum
CREATE TYPE "BrandDocKind" AS ENUM ('BRAND_BOOK', 'WRITING_GUIDE', 'OTHER');

-- AlterTable
ALTER TABLE "ContentProfile" ADD COLUMN     "basedOnVersion" INTEGER,
ADD COLUMN     "brandDocIds" TEXT[];

-- CreateTable
CREATE TABLE "BrandDocument" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "kind" "BrandDocKind" NOT NULL DEFAULT 'BRAND_BOOK',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fileName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandDocument_topicId_isActive_idx" ON "BrandDocument"("topicId", "isActive");

-- AddForeignKey
ALTER TABLE "BrandDocument" ADD CONSTRAINT "BrandDocument_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandDocument" ADD CONSTRAINT "BrandDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
