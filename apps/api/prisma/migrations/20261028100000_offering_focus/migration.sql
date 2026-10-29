-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "offeringId" TEXT,
ADD COLUMN     "segmentId" TEXT;

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "offeringId" TEXT,
ADD COLUMN     "segmentId" TEXT;

-- CreateIndex
CREATE INDEX "Content_offeringId_idx" ON "Content"("offeringId");

-- CreateIndex
CREATE INDEX "Content_segmentId_idx" ON "Content"("segmentId");

-- CreateIndex
CREATE INDEX "Topic_offeringId_idx" ON "Topic"("offeringId");

-- CreateIndex
CREATE INDEX "Topic_segmentId_idx" ON "Topic"("segmentId");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "BusinessOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "BusinessSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "BusinessOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "BusinessSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

