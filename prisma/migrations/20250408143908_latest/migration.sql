/*
  Warnings:

  - Added the required column `startDate` to the `employees` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "startDate" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "salary" SET DEFAULT 0.00;
