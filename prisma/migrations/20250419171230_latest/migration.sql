/*
  Warnings:

  - The values [PART_TIME,INTERN] on the enum `EmploymentType` will be removed. If these variants are still used in the database, this will fail.
  - The values [MATERNITY,PATERNITY] on the enum `LeaveType` will be removed. If these variants are still used in the database, this will fail.
  - The values [PENDING_APPROVAL,REJECTED,PROCESSING_PAYMENT,PAYMENT_FAILED] on the enum `PayrollStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `action` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `entityId` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `entityType` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `ipAddress` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `payFrequency` on the `companies` table. All the data in the column will be lost.
  - You are about to drop the column `taxIdNumber` on the `companies` table. All the data in the column will be lost.
  - You are about to drop the column `bonusAmount` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `commissionAmount` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `federalTax` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `healthInsuranceDeduction` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `localTax` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `otherDeductions` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `overtimeHours` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `overtimePayAmount` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `regularPayAmount` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `retirementDeduction` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `stateTax` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `totalDeductions` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `totalTaxes` on the `employee_payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `bankAccountNumber` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `bankName` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `department` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `endDate` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `jobTitle` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `startDate` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `processedAt` on the `leave_requests` table. All the data in the column will be lost.
  - You are about to drop the column `processedById` on the `leave_requests` table. All the data in the column will be lost.
  - You are about to drop the column `approvedAt` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `approvedById` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `cancelledAt` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `cancelledById` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `employeeCount` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `generatedAt` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `generatedById` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `paidAt` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `paidById` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `totalDeductions` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the column `totalTaxes` on the `payrolls` table. All the data in the column will be lost.
  - You are about to drop the `_RejectedLeaveByUser` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `actionType` to the `audit_logs` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AuditActionType" AS ENUM ('PAYROLL_GENERATED', 'PAYROLL_QUEUE_FAILURE', 'PAYROLL_APPROVED', 'PAYROLL_PAID', 'PAYROLL_REJECTED', 'PAYROLL_CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "EmploymentType_new" AS ENUM ('FULL_TIME', 'CONTRACTOR');
ALTER TABLE "employees" ALTER COLUMN "employmentType" DROP DEFAULT;
ALTER TABLE "employees" ALTER COLUMN "employmentType" TYPE "EmploymentType_new" USING ("employmentType"::text::"EmploymentType_new");
ALTER TYPE "EmploymentType" RENAME TO "EmploymentType_old";
ALTER TYPE "EmploymentType_new" RENAME TO "EmploymentType";
DROP TYPE "EmploymentType_old";
ALTER TABLE "employees" ALTER COLUMN "employmentType" SET DEFAULT 'FULL_TIME';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "LeaveType_new" AS ENUM ('ANNUAL', 'SICK', 'UNPAID');
ALTER TABLE "employee_payrolls" ALTER COLUMN "leaveType" TYPE "LeaveType_new" USING ("leaveType"::text::"LeaveType_new");
ALTER TABLE "leave_balances" ALTER COLUMN "leaveType" TYPE "LeaveType_new" USING ("leaveType"::text::"LeaveType_new");
ALTER TABLE "leave_requests" ALTER COLUMN "leaveType" TYPE "LeaveType_new" USING ("leaveType"::text::"LeaveType_new");
ALTER TYPE "LeaveType" RENAME TO "LeaveType_old";
ALTER TYPE "LeaveType_new" RENAME TO "LeaveType";
DROP TYPE "LeaveType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PayrollStatus_new" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'ERROR', 'CANCELLED');
ALTER TABLE "payrolls" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payrolls" ALTER COLUMN "status" TYPE "PayrollStatus_new" USING ("status"::text::"PayrollStatus_new");
ALTER TYPE "PayrollStatus" RENAME TO "PayrollStatus_old";
ALTER TYPE "PayrollStatus_new" RENAME TO "PayrollStatus";
DROP TYPE "PayrollStatus_old";
ALTER TABLE "payrolls" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "_RejectedLeaveByUser" DROP CONSTRAINT "_RejectedLeaveByUser_A_fkey";

-- DropForeignKey
ALTER TABLE "_RejectedLeaveByUser" DROP CONSTRAINT "_RejectedLeaveByUser_B_fkey";

-- DropForeignKey
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_processedById_fkey";

-- DropForeignKey
ALTER TABLE "payrolls" DROP CONSTRAINT "payrolls_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "payrolls" DROP CONSTRAINT "payrolls_cancelledById_fkey";

-- DropForeignKey
ALTER TABLE "payrolls" DROP CONSTRAINT "payrolls_generatedById_fkey";

-- DropForeignKey
ALTER TABLE "payrolls" DROP CONSTRAINT "payrolls_paidById_fkey";

-- DropIndex
DROP INDEX "audit_logs_entityType_entityId_idx";

-- DropIndex
DROP INDEX "employees_endDate_idx";

-- DropIndex
DROP INDEX "leave_requests_processedById_idx";

-- AlterTable
ALTER TABLE "audit_logs" DROP COLUMN "action",
DROP COLUMN "entityId",
DROP COLUMN "entityType",
DROP COLUMN "ipAddress",
ADD COLUMN     "actionType" "AuditActionType" NOT NULL,
ADD COLUMN     "payrollId" UUID;

-- AlterTable
ALTER TABLE "companies" DROP COLUMN "payFrequency",
DROP COLUMN "taxIdNumber";

-- AlterTable
ALTER TABLE "employee_payrolls" DROP COLUMN "bonusAmount",
DROP COLUMN "commissionAmount",
DROP COLUMN "federalTax",
DROP COLUMN "healthInsuranceDeduction",
DROP COLUMN "localTax",
DROP COLUMN "otherDeductions",
DROP COLUMN "overtimeHours",
DROP COLUMN "overtimePayAmount",
DROP COLUMN "regularPayAmount",
DROP COLUMN "retirementDeduction",
DROP COLUMN "stateTax",
DROP COLUMN "totalDeductions",
DROP COLUMN "totalTaxes";

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "bankAccountNumber",
DROP COLUMN "bankName",
DROP COLUMN "department",
DROP COLUMN "endDate",
DROP COLUMN "jobTitle",
DROP COLUMN "startDate";

-- AlterTable
ALTER TABLE "leave_requests" DROP COLUMN "processedAt",
DROP COLUMN "processedById";

-- AlterTable
ALTER TABLE "payrolls" DROP COLUMN "approvedAt",
DROP COLUMN "approvedById",
DROP COLUMN "cancelledAt",
DROP COLUMN "cancelledById",
DROP COLUMN "employeeCount",
DROP COLUMN "generatedAt",
DROP COLUMN "generatedById",
DROP COLUMN "notes",
DROP COLUMN "paidAt",
DROP COLUMN "paidById",
DROP COLUMN "totalDeductions",
DROP COLUMN "totalTaxes";

-- DropTable
DROP TABLE "_RejectedLeaveByUser";

-- DropEnum
DROP TYPE "PayFrequency";

-- CreateIndex
CREATE INDEX "audit_logs_actionType_idx" ON "audit_logs"("actionType");

-- CreateIndex
CREATE INDEX "audit_logs_payrollId_idx" ON "audit_logs"("payrollId");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
