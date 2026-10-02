-- CreateEnum
CREATE TYPE "ReferenceKind" AS ENUM ('URL', 'GOOGLE_DOC', 'TEXT');

-- CreateEnum
CREATE TYPE "ReferenceStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterEnum
ALTER TYPE "BusinessOrigin" ADD VALUE 'SOURCES';

-- CreateTable
CREATE TABLE "BusinessReference" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "ReferenceKind" NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "status" "ReferenceStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fetchedAt" TIMESTAMP(3),
    "googleAccountId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleDriveAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleDriveAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessReference_businessId_createdAt_idx" ON "BusinessReference"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDriveAccount_email_key" ON "GoogleDriveAccount"("email");

-- AddForeignKey
ALTER TABLE "BusinessReference" ADD CONSTRAINT "BusinessReference_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessReference" ADD CONSTRAINT "BusinessReference_googleAccountId_fkey" FOREIGN KEY ("googleAccountId") REFERENCES "GoogleDriveAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessReference" ADD CONSTRAINT "BusinessReference_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleDriveAccount" ADD CONSTRAINT "GoogleDriveAccount_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

