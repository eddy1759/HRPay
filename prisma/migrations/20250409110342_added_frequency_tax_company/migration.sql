-- CreateEnum
CREATE TYPE "PayFrquency" AS ENUM ('WEEKLY', 'BI_WEEKLY', 'HOURLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "payFrequency" "PayFrquency" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "taxIdNumber" TEXT;
