/*
  Warnings:

  - The values [PROCESSING] on the enum `PayrollStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PayrollStatus_new" AS ENUM ('PENDING_GENERATION', 'GENERATING', 'DRAFT', 'GENERATION_FAILED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PROCESSING_PAYMENT', 'PAID', 'PAYMENT_FAILED', 'CANCELLED');
ALTER TABLE "payrolls" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payrolls" ALTER COLUMN "status" TYPE "PayrollStatus_new" USING ("status"::text::"PayrollStatus_new");
ALTER TYPE "PayrollStatus" RENAME TO "PayrollStatus_old";
ALTER TYPE "PayrollStatus_new" RENAME TO "PayrollStatus";
DROP TYPE "PayrollStatus_old";
ALTER TABLE "payrolls" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;
