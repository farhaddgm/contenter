-- CreateEnum
CREATE TYPE "FactCategory" AS ENUM ('IDENTITY', 'OFFER', 'PRICING', 'NUMBERS', 'CONTACT', 'LEGAL', 'OTHER');

-- CreateEnum
CREATE TYPE "TermKind" AS ENUM ('USE', 'AVOID');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('RUNNING', 'READY', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BusinessSectionKey" ADD VALUE 'GOALS';
ALTER TYPE "BusinessSectionKey" ADD VALUE 'FAQ';
ALTER TYPE "BusinessSectionKey" ADD VALUE 'CALENDAR';

-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'BUSINESS_AUDIT';

-- AlterTable
ALTER TABLE "BusinessSection" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- CreateTable
CREATE TABLE "BusinessFact" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" "FactCategory" NOT NULL DEFAULT 'OTHER',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "source" "SectionSource" NOT NULL DEFAULT 'ADMIN',
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessTerm" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "kind" "TermKind" NOT NULL DEFAULT 'USE',
    "alternatives" TEXT[],
    "note" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessAudit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'RUNNING',
    "score" INTEGER,
    "summary" TEXT NOT NULL DEFAULT '',
    "strengths" TEXT[],
    "issues" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "jobId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessFact_businessId_category_idx" ON "BusinessFact"("businessId", "category");

-- CreateIndex
CREATE INDEX "BusinessTerm_businessId_idx" ON "BusinessTerm"("businessId");

-- CreateIndex
CREATE INDEX "BusinessAudit_businessId_createdAt_idx" ON "BusinessAudit"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessSection" ADD CONSTRAINT "BusinessSection_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessFact" ADD CONSTRAINT "BusinessFact_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessFact" ADD CONSTRAINT "BusinessFact_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessTerm" ADD CONSTRAINT "BusinessTerm_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessAudit" ADD CONSTRAINT "BusinessAudit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Text an admin wrote (or restored) counts as reviewed by them; AI text starts unreviewed.
UPDATE "BusinessSection"
SET "reviewedAt" = "updatedAt", "reviewedById" = "updatedById"
WHERE "source" = 'ADMIN' AND "content" <> '';
