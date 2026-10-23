-- CreateTable
CREATE TABLE "BusinessCompetitorSource" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
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

    CONSTRAINT "BusinessCompetitorSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessCompetitorSource_competitorId_createdAt_idx" ON "BusinessCompetitorSource"("competitorId", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessCompetitorSource" ADD CONSTRAINT "BusinessCompetitorSource_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "BusinessCompetitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessCompetitorSource" ADD CONSTRAINT "BusinessCompetitorSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
