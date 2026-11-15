-- CreateEnum
CREATE TYPE "ReferenceAccess" AS ENUM ('NOT_CHECKED', 'OK', 'NO_ACCESS');

-- AlterTable
ALTER TABLE "BusinessReference" ADD COLUMN     "accessState" "ReferenceAccess" NOT NULL DEFAULT 'NOT_CHECKED';

-- AlterTable
ALTER TABLE "GoogleDriveAccount" ADD COLUMN     "allBusinesses" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "businessIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
