-- CreateEnum
CREATE TYPE "CompetitorKind" AS ENUM ('DIRECT', 'INDIRECT', 'REFERENCE');

-- CreateTable
CREATE TABLE "BusinessCompetitor" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CompetitorKind" NOT NULL DEFAULT 'DIRECT',
    "website" TEXT NOT NULL DEFAULT '',
    "instagram" TEXT NOT NULL DEFAULT '',
    "positioning" TEXT NOT NULL DEFAULT '',
    "pricing" TEXT NOT NULL DEFAULT '',
    "strengths" TEXT[],
    "weaknesses" TEXT[],
    "difference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessCompetitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessCompetitor_businessId_kind_idx" ON "BusinessCompetitor"("businessId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCompetitor_businessId_name_key" ON "BusinessCompetitor"("businessId", "name");

-- AddForeignKey
ALTER TABLE "BusinessCompetitor" ADD CONSTRAINT "BusinessCompetitor_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessCompetitor" ADD CONSTRAINT "BusinessCompetitor_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
