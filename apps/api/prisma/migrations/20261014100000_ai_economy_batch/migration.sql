-- CreateEnum
CREATE TYPE "AiBatchStatus" AS ENUM ('PENDING', 'SUBMITTED', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "AiJobStatus" ADD VALUE 'WAITING';

-- AlterTable
ALTER TABLE "AiJob" ADD COLUMN     "economy" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiBatchCall" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" "AiBatchStatus" NOT NULL DEFAULT 'PENDING',
    "batchRef" TEXT,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBatchCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiBatchCall_status_createdAt_idx" ON "AiBatchCall"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiBatchCall_batchRef_idx" ON "AiBatchCall"("batchRef");

-- CreateIndex
CREATE UNIQUE INDEX "AiBatchCall_jobId_seq_key" ON "AiBatchCall"("jobId", "seq");

-- AddForeignKey
ALTER TABLE "AiBatchCall" ADD CONSTRAINT "AiBatchCall_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

