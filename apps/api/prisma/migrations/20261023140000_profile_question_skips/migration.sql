-- CreateTable
CREATE TABLE "BusinessQuestionSkip" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessQuestionSkip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessQuestionSkip_businessId_code_key" ON "BusinessQuestionSkip"("businessId", "code");

-- AddForeignKey
ALTER TABLE "BusinessQuestionSkip" ADD CONSTRAINT "BusinessQuestionSkip_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
