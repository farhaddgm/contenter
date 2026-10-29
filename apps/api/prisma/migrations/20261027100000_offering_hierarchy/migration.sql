-- CreateEnum
CREATE TYPE "SegmentKind" AS ENUM ('MARKET', 'PERSONA');

-- AlterTable
ALTER TABLE "BusinessOffering" ADD COLUMN "parentId" TEXT,
ADD COLUMN "guardrails" TEXT[];

-- CreateTable
CREATE TABLE "BusinessSegment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "SegmentKind" NOT NULL DEFAULT 'PERSONA',
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "goals" TEXT[],
    "pains" TEXT[],
    "objections" TEXT[],
    "channels" TEXT[],
    "messageAngle" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferingSegment" (
    "offeringId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "fit" INTEGER NOT NULL DEFAULT 2,

    CONSTRAINT "OfferingSegment_pkey" PRIMARY KEY ("offeringId","segmentId")
);

-- CreateIndex
CREATE INDEX "BusinessOffering_parentId_idx" ON "BusinessOffering"("parentId");

-- CreateIndex
CREATE INDEX "BusinessSegment_businessId_kind_idx" ON "BusinessSegment"("businessId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSegment_businessId_name_key" ON "BusinessSegment"("businessId", "name");

-- CreateIndex
CREATE INDEX "OfferingSegment_segmentId_idx" ON "OfferingSegment"("segmentId");

-- AddForeignKey
ALTER TABLE "BusinessOffering" ADD CONSTRAINT "BusinessOffering_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "BusinessOffering"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSegment" ADD CONSTRAINT "BusinessSegment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSegment" ADD CONSTRAINT "BusinessSegment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferingSegment" ADD CONSTRAINT "OfferingSegment_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "BusinessOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferingSegment" ADD CONSTRAINT "OfferingSegment_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "BusinessSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
