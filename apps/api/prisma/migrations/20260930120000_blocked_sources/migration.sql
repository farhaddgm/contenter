-- CreateEnum
CREATE TYPE "SourceBlockKind" AS ENUM ('URL', 'DOMAIN');

-- CreateTable
CREATE TABLE "BlockedSource" (
    "id" TEXT NOT NULL,
    "kind" "SourceBlockKind" NOT NULL,
    "value" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedSource_kind_value_key" ON "BlockedSource"("kind", "value");

-- AddForeignKey
ALTER TABLE "BlockedSource" ADD CONSTRAINT "BlockedSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
