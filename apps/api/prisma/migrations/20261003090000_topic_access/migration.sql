-- CreateEnum
CREATE TYPE "TopicAccess" AS ENUM ('VIEW', 'EDIT');

-- CreateTable
CREATE TABLE "TopicMember" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "access" "TopicAccess" NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TopicMember_userId_idx" ON "TopicMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TopicMember_topicId_userId_key" ON "TopicMember"("topicId", "userId");

-- AddForeignKey
ALTER TABLE "TopicMember" ADD CONSTRAINT "TopicMember_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicMember" ADD CONSTRAINT "TopicMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicMember" ADD CONSTRAINT "TopicMember_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
