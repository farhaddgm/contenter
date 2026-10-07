-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedUrl" TEXT,
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Content_scheduledAt_idx" ON "Content"("scheduledAt");

-- CreateIndex
CREATE INDEX "Content_publishedAt_idx" ON "Content"("publishedAt");

