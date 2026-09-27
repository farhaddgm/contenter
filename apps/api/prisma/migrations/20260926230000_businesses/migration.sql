-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BusinessOrigin" AS ENUM ('MANUAL', 'RESEARCH');

-- CreateEnum
CREATE TYPE "BusinessBuildState" AS ENUM ('NONE', 'BUILDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "BusinessSectionKey" AS ENUM ('OVERVIEW', 'SERVICES', 'TARGET_MARKET', 'PERSONAS', 'VALUE_PROPOSITION', 'COMPETITORS', 'BRAND_VOICE', 'BRAND_BOOK', 'KEY_MESSAGES', 'CONTENT_PILLARS', 'GUIDELINES', 'CHANNELS');

-- CreateEnum
CREATE TYPE "SectionSource" AS ENUM ('ADMIN', 'AI');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('RESEARCHING', 'READY', 'FAILED', 'USED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiJobType" ADD VALUE 'BUSINESS_DISCOVER';
ALTER TYPE "AiJobType" ADD VALUE 'BUSINESS_BUILD';
ALTER TYPE "AiJobType" ADD VALUE 'BUSINESS_SUGGEST';

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "businessId" TEXT;

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "industry" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT 'fa',
    "keyword" TEXT,
    "status" "BusinessStatus" NOT NULL DEFAULT 'ACTIVE',
    "origin" "BusinessOrigin" NOT NULL DEFAULT 'MANUAL',
    "buildState" "BusinessBuildState" NOT NULL DEFAULT 'NONE',
    "buildError" TEXT,
    "lastJobId" TEXT,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "gaps" TEXT[],
    "researchedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" "BusinessSectionKey" NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "source" "SectionSource" NOT NULL DEFAULT 'ADMIN',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSectionRevision" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" "SectionSource" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessSectionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSuggestion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" "BusinessSectionKey" NOT NULL,
    "content" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessDiscovery" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT 'fa',
    "count" INTEGER NOT NULL DEFAULT 5,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'RESEARCHING',
    "summary" TEXT NOT NULL DEFAULT '',
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "selectedIndex" INTEGER,
    "businessId" TEXT,
    "jobId" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessDiscovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Business_status_updatedAt_idx" ON "Business"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSection_businessId_key_key" ON "BusinessSection"("businessId", "key");

-- CreateIndex
CREATE INDEX "BusinessSectionRevision_sectionId_createdAt_idx" ON "BusinessSectionRevision"("sectionId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessSuggestion_businessId_status_idx" ON "BusinessSuggestion"("businessId", "status");

-- CreateIndex
CREATE INDEX "BusinessDiscovery_createdAt_idx" ON "BusinessDiscovery"("createdAt");

-- CreateIndex
CREATE INDEX "Topic_businessId_idx" ON "Topic"("businessId");

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSection" ADD CONSTRAINT "BusinessSection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSection" ADD CONSTRAINT "BusinessSection_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSectionRevision" ADD CONSTRAINT "BusinessSectionRevision_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "BusinessSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSectionRevision" ADD CONSTRAINT "BusinessSectionRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSuggestion" ADD CONSTRAINT "BusinessSuggestion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDiscovery" ADD CONSTRAINT "BusinessDiscovery_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessDiscovery" ADD CONSTRAINT "BusinessDiscovery_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

