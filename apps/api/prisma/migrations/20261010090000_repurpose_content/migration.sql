-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'REPURPOSE_CONTENT';

-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "platform" "Platform",
ADD COLUMN     "sourceContentId" TEXT;

-- CreateIndex
CREATE INDEX "Content_sourceContentId_idx" ON "Content"("sourceContentId");

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_sourceContentId_fkey" FOREIGN KEY ("sourceContentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

