/*
  Warnings:

  - A unique constraint covering the columns `[token,status]` on the table `invitations` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "invitations_token_status_idx";

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_status_key" ON "invitations"("token", "status");
