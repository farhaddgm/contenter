-- CreateEnum
CREATE TYPE "ReferenceAudience" AS ENUM ('AI', 'APPS', 'BOTH');

-- AlterTable
ALTER TABLE "BusinessReference" ADD COLUMN     "audience" "ReferenceAudience" NOT NULL DEFAULT 'AI',
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '';
