-- Part requests (RFQ, "اطلب قطعة") + private offers created from accepted quotes.

-- CreateEnum
CREATE TYPE "OfferVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "PartRequestStatus" AS ENUM ('OPEN', 'QUOTED', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PartQuoteStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PartPreference" AS ENUM ('ANY', 'NEW', 'USED', 'OEM', 'AFTERMARKET');

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "privateForUserId" TEXT,
ADD COLUMN     "visibility" "OfferVisibility" NOT NULL DEFAULT 'PUBLIC';

-- CreateTable
CREATE TABLE "PartRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "garageVehicleId" TEXT,
    "makeId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "engine" TEXT,
    "vin" TEXT,
    "description" TEXT NOT NULL,
    "partNumber" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "photoKeys" TEXT[],
    "preferredCondition" "PartPreference" NOT NULL DEFAULT 'ANY',
    "preferredOrigin" "PartPreference" NOT NULL DEFAULT 'ANY',
    "addressId" TEXT,
    "city" TEXT NOT NULL,
    "status" "PartRequestStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firstQuotedAt" TIMESTAMP(3),
    "acceptedQuoteId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartQuote" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT,
    "partName" TEXT,
    "brand" TEXT,
    "partNumber" TEXT,
    "categoryId" TEXT,
    "origin" "PartOrigin",
    "condition" "Condition" NOT NULL,
    "priceHalalas" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    "dispatchDaysMin" INTEGER NOT NULL DEFAULT 0,
    "dispatchDaysMax" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "photoKey" TEXT,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" "PartQuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "offerId" TEXT,
    "createdById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartRequest_number_key" ON "PartRequest"("number");

-- CreateIndex
CREATE UNIQUE INDEX "PartRequest_acceptedQuoteId_key" ON "PartRequest"("acceptedQuoteId");

-- CreateIndex
CREATE INDEX "PartRequest_customerId_createdAt_idx" ON "PartRequest"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "PartRequest_status_city_idx" ON "PartRequest"("status", "city");

-- CreateIndex
CREATE INDEX "PartRequest_status_makeId_idx" ON "PartRequest"("status", "makeId");

-- CreateIndex
CREATE INDEX "PartRequest_status_expiresAt_idx" ON "PartRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PartRequest_createdAt_idx" ON "PartRequest"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartQuote_offerId_key" ON "PartQuote"("offerId");

-- CreateIndex
CREATE INDEX "PartQuote_merchantId_status_idx" ON "PartQuote"("merchantId", "status");

-- CreateIndex
CREATE INDEX "PartQuote_status_validUntil_idx" ON "PartQuote"("status", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "PartQuote_requestId_merchantId_key" ON "PartQuote"("requestId", "merchantId");

-- CreateIndex
CREATE INDEX "Offer_privateForUserId_idx" ON "Offer"("privateForUserId");

-- AddForeignKey
ALTER TABLE "PartQuote" ADD CONSTRAINT "PartQuote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PartRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartQuote" ADD CONSTRAINT "PartQuote_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A private offer always names its buyer; a public one never does.
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_private_owner_check" CHECK (("visibility" = 'PRIVATE') = ("privateForUserId" IS NOT NULL));

ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_quantity_check" CHECK ("quantity" BETWEEN 1 AND 20);
ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_photos_check" CHECK (coalesce(array_length("photoKeys", 1), 0) <= 3);
ALTER TABLE "PartQuote" ADD CONSTRAINT "PartQuote_amounts_check" CHECK ("priceHalalas" > 0 AND "quantity" > 0 AND "warrantyMonths" >= 0 AND "dispatchDaysMin" >= 0 AND "dispatchDaysMax" >= "dispatchDaysMin");
