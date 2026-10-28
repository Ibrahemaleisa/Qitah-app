-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('WORKSHOP', 'FLEET');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('APPLIED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'BUYER', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "OrganizationMemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "OrganizationCreditStatus" AS ENUM ('ACTIVE', 'FROZEN');

-- CreateEnum
CREATE TYPE "WorkshopQuoteStatus" AS ENUM ('SENT', 'APPROVED', 'DECLINED', 'EXPIRED', 'CONVERTED');

-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'CUSTOMER_RECEIVABLE';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "buyerOrgId" TEXT,
ADD COLUMN     "creditDueAt" TIMESTAMP(3),
ADD COLUMN     "workOrderRef" TEXT,
ADD COLUMN     "workshopQuoteId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL DEFAULT 'WORKSHOP',
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "crNumber" TEXT NOT NULL,
    "vatNumber" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "contactPhone" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'APPLIED',
    "statusReason" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "invitedPhone" TEXT,
    "role" "OrganizationRole" NOT NULL,
    "status" "OrganizationMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedById" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationCredit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "limitHalalas" INTEGER NOT NULL,
    "termsDays" INTEGER NOT NULL DEFAULT 30,
    "status" "OrganizationCreditStatus" NOT NULL DEFAULT 'ACTIVE',
    "provider" TEXT NOT NULL DEFAULT 'qitah-internal-sandbox',
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationRepayment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "amountHalalas" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "allocation" JSONB NOT NULL DEFAULT '[]',
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationRepayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopQuote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "vehicle" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "partsHalalas" INTEGER NOT NULL,
    "laborHalalas" INTEGER NOT NULL DEFAULT 0,
    "markupHalalas" INTEGER NOT NULL DEFAULT 0,
    "totalHalalas" INTEGER NOT NULL,
    "note" TEXT,
    "customerPhone" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "WorkshopQuoteStatus" NOT NULL DEFAULT 'SENT',
    "respondedAt" TIMESTAMP(3),
    "orderId" TEXT,
    "convertError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_status_createdAt_idx" ON "Organization"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Organization_crNumber_idx" ON "Organization"("crNumber");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_status_idx" ON "OrganizationMember"("userId", "status");

-- CreateIndex
CREATE INDEX "OrganizationMember_invitedPhone_status_idx" ON "OrganizationMember"("invitedPhone", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_orgId_userId_key" ON "OrganizationMember"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_orgId_invitedPhone_key" ON "OrganizationMember"("orgId", "invitedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationCredit_orgId_key" ON "OrganizationCredit"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationRepayment_idempotencyKey_key" ON "OrganizationRepayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OrganizationRepayment_orgId_createdAt_idx" ON "OrganizationRepayment"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopQuote_number_key" ON "WorkshopQuote"("number");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopQuote_tokenHash_key" ON "WorkshopQuote"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopQuote_orderId_key" ON "WorkshopQuote"("orderId");

-- CreateIndex
CREATE INDEX "WorkshopQuote_orgId_createdAt_idx" ON "WorkshopQuote"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopQuote_status_expiresAt_idx" ON "WorkshopQuote"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_workshopQuoteId_key" ON "Order"("workshopQuoteId");

-- CreateIndex
CREATE INDEX "Order_buyerOrgId_createdAt_idx" ON "Order"("buyerOrgId", "createdAt");

-- CreateIndex

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerOrgId_fkey" FOREIGN KEY ("buyerOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCredit" ADD CONSTRAINT "OrganizationCredit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationRepayment" ADD CONSTRAINT "OrganizationRepayment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopQuote" ADD CONSTRAINT "WorkshopQuote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Money / invariants (hand-written; Prisma does not model CHECK constraints)
ALTER TABLE "OrganizationCredit" ADD CONSTRAINT "org_credit_limit_nonneg" CHECK ("limitHalalas" >= 0);
ALTER TABLE "OrganizationCredit" ADD CONSTRAINT "org_credit_terms_range" CHECK ("termsDays" BETWEEN 0 AND 180);
ALTER TABLE "OrganizationRepayment" ADD CONSTRAINT "org_repayment_positive" CHECK ("amountHalalas" > 0);
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "org_member_identity" CHECK ("userId" IS NOT NULL OR "invitedPhone" IS NOT NULL);
ALTER TABLE "WorkshopQuote" ADD CONSTRAINT "workshop_quote_amounts" CHECK ("partsHalalas" >= 0 AND "laborHalalas" >= 0 AND "markupHalalas" >= 0 AND "totalHalalas" = "partsHalalas" + "laborHalalas" + "markupHalalas");
