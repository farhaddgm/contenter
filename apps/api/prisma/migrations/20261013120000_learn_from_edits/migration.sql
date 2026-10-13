-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'LEARN_FROM_EDITS';

-- CreateTable
CREATE TABLE "EditLearningRun" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "jobId" TEXT,
    "pairCount" INTEGER NOT NULL,
    "avgChangeRatio" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditLearningRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSuggestion" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "PrincipleKind" NOT NULL,
    "category" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "evidence" JSONB NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "principleId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EditLearningRun_topicId_createdAt_idx" ON "EditLearningRun"("topicId", "createdAt");

-- CreateIndex
CREATE INDEX "LearningSuggestion_topicId_status_idx" ON "LearningSuggestion"("topicId", "status");

-- CreateIndex
CREATE INDEX "LearningSuggestion_runId_idx" ON "LearningSuggestion"("runId");

-- AddForeignKey
ALTER TABLE "EditLearningRun" ADD CONSTRAINT "EditLearningRun_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSuggestion" ADD CONSTRAINT "LearningSuggestion_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSuggestion" ADD CONSTRAINT "LearningSuggestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EditLearningRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

