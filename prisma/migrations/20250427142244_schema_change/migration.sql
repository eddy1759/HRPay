/*
  Warnings:

  - The `role` column on the `invitations` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `companyId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,companyId]` on the table `employees` will be added. If there are existing duplicate values, this will fail.
  - Made the column `userId` on table `employees` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "SystemUserRole" AS ENUM ('SUPER_ADMIN', 'BASIC_USER');

-- CreateEnum
CREATE TYPE "EmployeeUserRole" AS ENUM ('ADMIN', 'EMPLOYEE');

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_userId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_companyId_fkey";

-- DropIndex
DROP INDEX "employees_companyId_isActive_idx";

-- DropIndex
DROP INDEX "employees_email_companyId_key";

-- DropIndex
DROP INDEX "employees_userId_key";

-- DropIndex
DROP INDEX "invitations_token_idx";

-- DropIndex
DROP INDEX "users_companyId_idx";

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "role" "EmployeeUserRole" NOT NULL DEFAULT 'EMPLOYEE',
ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "invitations" DROP COLUMN "role",
ADD COLUMN     "role" "EmployeeUserRole" NOT NULL DEFAULT 'EMPLOYEE';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "companyId",
DROP COLUMN "role",
ADD COLUMN     "systemRole" "SystemUserRole" NOT NULL DEFAULT 'BASIC_USER';

-- DropEnum
DROP TYPE "UserRole";

-- CreateIndex
CREATE INDEX "employees_companyId_idx" ON "employees"("companyId");

-- CreateIndex
CREATE INDEX "employees_isActive_idx" ON "employees"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_companyId_key" ON "employees"("userId", "companyId");

-- CreateIndex
CREATE INDEX "invitations_acceptedByUserId_idx" ON "invitations"("acceptedByUserId");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
