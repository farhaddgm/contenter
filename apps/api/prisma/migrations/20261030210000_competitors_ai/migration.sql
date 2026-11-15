-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'BUSINESS_COMPETITORS_PROPOSE';

-- AlterTable
ALTER TABLE "BusinessCompetitor" ADD COLUMN     "evidence" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "source" "SectionSource" NOT NULL DEFAULT 'ADMIN',
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT true;
