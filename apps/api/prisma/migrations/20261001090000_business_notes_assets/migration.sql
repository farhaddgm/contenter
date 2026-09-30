-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "NoteApplyMode" AS ENUM ('DIRECT', 'SUGGEST');

-- CreateEnum
CREATE TYPE "BusinessAssetKind" AS ENUM ('ARTICLE', 'IMAGE', 'BANNER', 'ARTWORK', 'CREATIVE', 'VIDEO', 'MOTION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiJobType" ADD VALUE 'BUSINESS_REVISE';
ALTER TYPE "AiJobType" ADD VALUE 'BUSINESS_ASSET_ANALYZE';

-- CreateTable
CREATE TABLE "BusinessNote" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "apply" "NoteApplyMode" NOT NULL DEFAULT 'DIRECT',
    "scope" TEXT NOT NULL DEFAULT 'NONE',
    "status" "NoteStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT NOT NULL DEFAULT '',
    "changedKeys" "BusinessSectionKey"[],
    "error" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "jobId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessAsset" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "BusinessAssetKind" NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "storageKey" TEXT,
    "previews" TEXT[],
    "remoteImages" TEXT[],
    "analysisStatus" "AnalysisStatus" NOT NULL DEFAULT 'NONE',
    "analysis" JSONB,
    "analysisError" TEXT,
    "lastJobId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessNote_businessId_createdAt_idx" ON "BusinessNote"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessAsset_businessId_createdAt_idx" ON "BusinessAsset"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessNote" ADD CONSTRAINT "BusinessNote_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessNote" ADD CONSTRAINT "BusinessNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessAsset" ADD CONSTRAINT "BusinessAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessAsset" ADD CONSTRAINT "BusinessAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data fix: research sources on Google Drive/Docs were never about the business — they came
-- from a "search only my references' sites" run that treated drive.google.com as such a site.
UPDATE "Business" SET "sources" = COALESCE(
  (SELECT jsonb_agg(s) FROM jsonb_array_elements("sources") s
    WHERE s->>'url' !~* '^https?://(drive|docs)\.google\.com/'), '[]'::jsonb)
WHERE "sources"::text ~* '//(drive|docs)\.google\.com/';

UPDATE "BusinessDiscovery" SET "sources" = COALESCE(
  (SELECT jsonb_agg(s) FROM jsonb_array_elements("sources") s
    WHERE s->>'url' !~* '^https?://(drive|docs)\.google\.com/'), '[]'::jsonb)
WHERE "sources"::text ~* '//(drive|docs)\.google\.com/';

-- Data fix: Google Drive links stored as plain web pages hold the Google sign-in page, not the
-- content. Mark them unread so "read again" goes through the connected Google account.
UPDATE "BusinessReference"
SET "kind" = 'GOOGLE_DOC', "status" = 'FAILED', "content" = '', "title" = '',
    "error" = 'This Google Drive link was stored as a sign-in page. Use "read again" to load its files through the connected Google account.'
WHERE "kind" = 'URL' AND "url" ~* '^https?://(drive|docs)\.google\.com/';
