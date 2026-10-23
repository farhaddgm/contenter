-- CreateEnum
CREATE TYPE "SectionLock" AS ENUM ('NONE', 'AI_ONLY', 'ADMIN_ONLY');

-- AlterTable
ALTER TABLE "BusinessSection" ADD COLUMN     "lock" "SectionLock" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "lockNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedById" TEXT;

-- AddForeignKey
ALTER TABLE "BusinessSection" ADD CONSTRAINT "BusinessSection_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

