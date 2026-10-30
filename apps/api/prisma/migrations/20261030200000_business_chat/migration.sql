-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'BUSINESS_CHAT';

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ChatMessageStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ChatState" AS ENUM ('OPEN', 'APPLIED');

-- CreateTable
CREATE TABLE "BusinessChat" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "state" "ChatState" NOT NULL DEFAULT 'OPEN',
    "digest" JSONB,
    "digestStatus" TEXT NOT NULL DEFAULT 'NONE',
    "digestError" TEXT,
    "digestJobId" TEXT,
    "digestUpTo" INTEGER NOT NULL DEFAULT 0,
    "noteId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessChatMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "status" "ChatMessageStatus" NOT NULL DEFAULT 'DONE',
    "error" TEXT,
    "understood" JSONB,
    "questions" TEXT[],
    "conflicts" TEXT[],
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessChat_businessId_state_idx" ON "BusinessChat"("businessId", "state");

-- CreateIndex
CREATE INDEX "BusinessChatMessage_chatId_createdAt_idx" ON "BusinessChatMessage"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessChat" ADD CONSTRAINT "BusinessChat_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessChat" ADD CONSTRAINT "BusinessChat_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessChatMessage" ADD CONSTRAINT "BusinessChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "BusinessChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
