-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'EMBED_REFERENCE';

-- CreateTable
CREATE TABLE "ReferenceChunk" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "model" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferenceChunk_businessId_idx" ON "ReferenceChunk"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceChunk_referenceId_idx_key" ON "ReferenceChunk"("referenceId", "idx");

-- AddForeignKey
ALTER TABLE "ReferenceChunk" ADD CONSTRAINT "ReferenceChunk_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "BusinessReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

