/*
  Warnings:

  - The values [PENDING_GENERATION,GENERATING,GENERATION_FAILED] on the enum `PayrollStatus` will be removed. If these variants are still used in the database, this will fail.
  - The `payFrequency` column on the `companies` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `deductions` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `processedAt` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `totalAmount` on the `payrolls` table. All the data in the column will be lost.
  - Added the required column `totalDeductions` to the `employee_payrolls` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalTaxes` to the `employee_payrolls` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PayFrequency" AS ENUM ('WEEKLY', 'BI_WEEKLY', 'SEMI_MONTHLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'INTERN');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('SALARY', 'HOURLY');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'PATERNITY');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "PayrollStatus_new" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PROCESSING_PAYMENT', 'PAID', 'PAYMENT_FAILED', 'CANCELLED');
ALTER TABLE "payrolls" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payrolls" ALTER COLUMN "status" TYPE "PayrollStatus_new" USING ("status"::text::"PayrollStatus_new");
ALTER TYPE "PayrollStatus" RENAME TO "PayrollStatus_old";
ALTER TYPE "PayrollStatus_new" RENAME TO "PayrollStatus";
DROP TYPE "PayrollStatus_old";
ALTER TABLE "payrolls" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropIndex
DROP INDEX "employees_companyId_idx";

-- DropIndex
DROP INDEX "payrolls_companyId_idx";

-- DropIndex
DROP INDEX "payrolls_processedAt_idx";

-- AlterTable
ALTER TABLE "companies" DROP COLUMN "payFrequency",
ADD COLUMN     "payFrequency" "PayFrequency" NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE "employee_payrolls" DROP COLUMN "deductions",
ADD COLUMN     "bonusAmount" DECIMAL(12,2),
ADD COLUMN     "commissionAmount" DECIMAL(12,2),
ADD COLUMN     "federalTax" DECIMAL(10,2),
ADD COLUMN     "healthInsuranceDeduction" DECIMAL(10,2),
ADD COLUMN     "leaveHoursUsed" DECIMAL(6,2),
ADD COLUMN     "leaveType" "LeaveType",
ADD COLUMN     "localTax" DECIMAL(10,2),
ADD COLUMN     "otherDeductions" DECIMAL(10,2),
ADD COLUMN     "overtimeHours" DECIMAL(6,2),
ADD COLUMN     "overtimePayAmount" DECIMAL(12,2),
ADD COLUMN     "regularHoursWorked" DECIMAL(6,2),
ADD COLUMN     "regularPayAmount" DECIMAL(12,2),
ADD COLUMN     "retirementDeduction" DECIMAL(10,2),
ADD COLUMN     "stateTax" DECIMAL(10,2),
ADD COLUMN     "totalDeductions" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "totalTaxes" DECIMAL(12,2) NOT NULL;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "payRate" DECIMAL(10,2),
ADD COLUMN     "payType" "PayType" NOT NULL DEFAULT 'SALARY',
ALTER COLUMN "salary" DROP NOT NULL,
ALTER COLUMN "salary" DROP DEFAULT,
ALTER COLUMN "startDate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payrolls" DROP COLUMN "processedAt",
DROP COLUMN "totalAmount",
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" UUID,
ADD COLUMN     "employeeCount" INTEGER,
ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "generatedById" UUID,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidById" UUID,
ADD COLUMN     "paymentDate" TIMESTAMP(3),
ADD COLUMN     "totalDeductions" DECIMAL(14,2),
ADD COLUMN     "totalGross" DECIMAL(14,2),
ADD COLUMN     "totalNet" DECIMAL(14,2),
ADD COLUMN     "totalTaxes" DECIMAL(14,2);

-- DropEnum
DROP TYPE "PayFrquency";

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "balance" DECIMAL(6,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'days',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "duration" DECIMAL(6,2) NOT NULL,
    "reason" TEXT,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "processedById" UUID,
    "processedAt" TIMESTAMP(3),
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "details" JSONB,
    "ipAddress" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RejectedLeaveByUser" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

-- CreateIndex
CREATE INDEX "leave_balances_employeeId_idx" ON "leave_balances"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_employeeId_leaveType_key" ON "leave_balances"("employeeId", "leaveType");

-- CreateIndex
CREATE INDEX "leave_requests_employeeId_idx" ON "leave_requests"("employeeId");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE INDEX "leave_requests_processedById_idx" ON "leave_requests"("processedById");

-- CreateIndex
CREATE INDEX "leave_requests_startDate_endDate_idx" ON "leave_requests"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "_RejectedLeaveByUser_AB_unique" ON "_RejectedLeaveByUser"("A", "B");

-- CreateIndex
CREATE INDEX "_RejectedLeaveByUser_B_index" ON "_RejectedLeaveByUser"("B");

-- CreateIndex
CREATE INDEX "employees_companyId_isActive_idx" ON "employees"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "employees_endDate_idx" ON "employees"("endDate");

-- CreateIndex
CREATE INDEX "payrolls_companyId_periodStart_periodEnd_idx" ON "payrolls"("companyId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "payrolls_paymentDate_idx" ON "payrolls"("paymentDate");

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RejectedLeaveByUser" ADD CONSTRAINT "_RejectedLeaveByUser_A_fkey" FOREIGN KEY ("A") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RejectedLeaveByUser" ADD CONSTRAINT "_RejectedLeaveByUser_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
