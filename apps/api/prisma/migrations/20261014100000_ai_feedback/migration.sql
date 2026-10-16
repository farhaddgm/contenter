-- CreateEnum
CREATE TYPE "FeedbackTarget" AS ENUM ('CONTENT_VERSION', 'PROFILE');

-- CreateEnum
CREATE TYPE "FeedbackRating" AS ENUM ('UP', 'DOWN');

-- CreateTable
CREATE TABLE "AiFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" "FeedbackTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "jobId" TEXT,
    "rating" "FeedbackRating" NOT NULL,
    "reason" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiFeedback_topicId_targetType_idx" ON "AiFeedback"("topicId", "targetType");

-- CreateIndex
CREATE INDEX "AiFeedback_jobId_idx" ON "AiFeedback"("jobId");

-- CreateIndex
CREATE INDEX "AiFeedback_createdAt_idx" ON "AiFeedback"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiFeedback_userId_targetType_targetId_key" ON "AiFeedback"("userId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

