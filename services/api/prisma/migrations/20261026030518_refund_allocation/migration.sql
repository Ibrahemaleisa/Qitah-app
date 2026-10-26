-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "allocation" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "failureReason" TEXT;
