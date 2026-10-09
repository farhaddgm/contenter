-- AlterEnum
ALTER TYPE "ReferenceKind" ADD VALUE 'INSTAGRAM';
ALTER TYPE "ReferenceKind" ADD VALUE 'WEBSITE';

-- AlterTable
ALTER TABLE "BusinessReference" ADD COLUMN     "analysis" JSONB;
