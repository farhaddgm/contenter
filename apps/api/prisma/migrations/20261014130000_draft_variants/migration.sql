-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "variantAngle" TEXT,
ADD COLUMN     "variantGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Content_variantGroupId_idx" ON "Content"("variantGroupId");

