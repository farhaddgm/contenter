-- CreateEnum
CREATE TYPE "StyleSourceKind" AS ENUM ('INSTAGRAM', 'WEBSITE', 'URL', 'TEXT');

-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'BUSINESS_STYLE_BUILD';

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "styleId" TEXT;

-- CreateTable
CREATE TABLE "BusinessStyle" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT '',
    "buildState" "BusinessBuildState" NOT NULL DEFAULT 'NONE',
    "buildError" TEXT,
    "lastJobId" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "traits" JSONB NOT NULL DEFAULT '[]',
    "guide" TEXT NOT NULL DEFAULT '',
    "caveats" TEXT[],
    "builtAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessStyle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleSource" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "kind" "StyleSourceKind" NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "analysis" JSONB,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessStyle_businessId_updatedAt_idx" ON "BusinessStyle"("businessId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessStyle_businessId_name_key" ON "BusinessStyle"("businessId", "name");

-- CreateIndex
CREATE INDEX "StyleSource_styleId_createdAt_idx" ON "StyleSource"("styleId", "createdAt");

-- CreateIndex
CREATE INDEX "Topic_styleId_idx" ON "Topic"("styleId");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "BusinessStyle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessStyle" ADD CONSTRAINT "BusinessStyle_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessStyle" ADD CONSTRAINT "BusinessStyle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleSource" ADD CONSTRAINT "StyleSource_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "BusinessStyle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleSource" ADD CONSTRAINT "StyleSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

