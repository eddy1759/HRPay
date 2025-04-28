-- DropIndex
DROP INDEX "employees_email_key";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payrolls" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;
