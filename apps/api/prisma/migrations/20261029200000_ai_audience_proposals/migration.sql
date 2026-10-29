-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'BUSINESS_SEGMENTS_PROPOSE';

-- AlterTable
ALTER TABLE "BusinessSegment" ADD COLUMN     "evidence" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "source" "SectionSource" NOT NULL DEFAULT 'ADMIN',
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT true;

