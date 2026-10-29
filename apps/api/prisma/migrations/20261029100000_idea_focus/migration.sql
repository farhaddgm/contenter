-- AlterTable
ALTER TABLE "Idea" ADD COLUMN     "offeringId" TEXT,
ADD COLUMN     "segmentId" TEXT;

-- CreateIndex
CREATE INDEX "Idea_offeringId_idx" ON "Idea"("offeringId");

-- CreateIndex
CREATE INDEX "Idea_segmentId_idx" ON "Idea"("segmentId");

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "BusinessOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "BusinessSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

