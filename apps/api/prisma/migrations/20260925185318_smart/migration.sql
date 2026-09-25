-- CreateEnum
CREATE TYPE "InteractionSource" AS ENUM ('CLIENT', 'SERVER');

-- CreateEnum
CREATE TYPE "ErrorSource" AS ENUM ('SERVER', 'CLIENT', 'AI_JOB');

-- CreateEnum
CREATE TYPE "ErrorStatus" AS ENUM ('NEW', 'SEEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('DATABASE', 'VALIDATION', 'AUTH', 'NETWORK', 'AI', 'NOT_FOUND', 'CLIENT_RUNTIME', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('WALKER', 'ERROR');

-- CreateEnum
CREATE TYPE "SmartMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "SmartMessageStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX');

-- CreateEnum
CREATE TYPE "IssueSource" AS ENUM ('WALKER_CHAT', 'ERROR_CHAT');

-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'SMART_CHAT';

-- CreateTable
CREATE TABLE "InteractionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "source" "InteractionSource" NOT NULL,
    "type" TEXT NOT NULL,
    "route" TEXT,
    "method" TEXT,
    "path" TEXT,
    "statusCode" INTEGER,
    "durationMs" INTEGER,
    "target" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InteractionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppError" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" "ErrorSource" NOT NULL,
    "category" "ErrorCategory" NOT NULL DEFAULT 'UNKNOWN',
    "message" TEXT NOT NULL,
    "hint" TEXT,
    "detail" TEXT,
    "statusCode" INTEGER,
    "method" TEXT,
    "path" TEXT,
    "route" TEXT,
    "jobId" TEXT,
    "userId" TEXT,
    "context" JSONB,
    "count" INTEGER NOT NULL DEFAULT 1,
    "status" "ErrorStatus" NOT NULL DEFAULT 'NEW',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ConversationKind" NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "errorId" TEXT,
    "topicId" TEXT,
    "route" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmartConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "SmartMessageRole" NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" "SmartMessageStatus" NOT NULL DEFAULT 'DONE',
    "context" JSONB,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmartMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkerIssue" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" "IssueSource" NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "conversationId" TEXT,
    "messageId" TEXT,
    "errorId" TEXT,
    "topicId" TEXT,
    "route" TEXT,
    "context" JSONB,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalkerIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InteractionLog_userId_createdAt_idx" ON "InteractionLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "InteractionLog_type_createdAt_idx" ON "InteractionLog"("type", "createdAt");

-- CreateIndex
CREATE INDEX "InteractionLog_createdAt_idx" ON "InteractionLog"("createdAt");

-- CreateIndex
CREATE INDEX "AppError_fingerprint_status_idx" ON "AppError"("fingerprint", "status");

-- CreateIndex
CREATE INDEX "AppError_status_lastSeenAt_idx" ON "AppError"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "AppError_lastSeenAt_idx" ON "AppError"("lastSeenAt");

-- CreateIndex
CREATE INDEX "SmartConversation_userId_updatedAt_idx" ON "SmartConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "SmartMessage_conversationId_createdAt_idx" ON "SmartMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "WalkerIssue_status_createdAt_idx" ON "WalkerIssue"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "InteractionLog" ADD CONSTRAINT "InteractionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppError" ADD CONSTRAINT "AppError_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartConversation" ADD CONSTRAINT "SmartConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartConversation" ADD CONSTRAINT "SmartConversation_errorId_fkey" FOREIGN KEY ("errorId") REFERENCES "AppError"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartMessage" ADD CONSTRAINT "SmartMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SmartConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkerIssue" ADD CONSTRAINT "WalkerIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkerIssue" ADD CONSTRAINT "WalkerIssue_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SmartConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkerIssue" ADD CONSTRAINT "WalkerIssue_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SmartMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkerIssue" ADD CONSTRAINT "WalkerIssue_errorId_fkey" FOREIGN KEY ("errorId") REFERENCES "AppError"("id") ON DELETE SET NULL ON UPDATE CASCADE;
