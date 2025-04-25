/*
  Warnings:

  - A unique constraint covering the columns `[email,companyId]` on the table `employees` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "employees_email_companyId_key" ON "employees"("email", "companyId");
