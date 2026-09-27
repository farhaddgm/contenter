-- CreateEnum
CREATE TYPE "LoginMethod" AS ENUM ('PASSWORD', 'GOOGLE', 'BOTH');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "googleSub" TEXT,
ADD COLUMN     "loginMethod" "LoginMethod" NOT NULL DEFAULT 'PASSWORD',
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

