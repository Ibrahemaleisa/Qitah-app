-- Merchant economics: per-line commission rules, payment-provider fees, automatic settlement with an
-- early-payout reserve, offer freshness (lastConfirmedAt) and job idempotency marks.

-- CreateEnum
CREATE TYPE "SettlementCadence" AS ENUM ('WEEKLY', 'DAILY');

-- CreateEnum
CREATE TYPE "SettlementLineKind" AS ENUM ('SALE', 'RESERVE_RELEASE');

-- CreateEnum
CREATE TYPE "CommissionChannel" AS ENUM ('B2C', 'B2B', 'ANY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerAccount" ADD VALUE 'PAYMENT_FEES';
ALTER TYPE "LedgerAccount" ADD VALUE 'MERCHANT_RESERVE';

-- DropIndex
DROP INDEX "SettlementLine_merchantOrderId_key";

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "settlementCadence" "SettlementCadence" NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "trustedForEarlyPayout" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qualityScore" INTEGER,
ADD COLUMN     "qualityScoreAt" TIMESTAMP(3),
ALTER COLUMN "commissionBps" DROP NOT NULL,
ALTER COLUMN "commissionBps" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "commissionBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionHalalas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionRuleId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "feeBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "feeEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "feeHalalas" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "automatic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reserveHeldHalalas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reserveReleasedHalalas" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SettlementLine" ADD COLUMN     "kind" "SettlementLineKind" NOT NULL DEFAULT 'SALE',
ADD COLUMN     "reserveHalalas" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "merchantId" TEXT,
    "categoryId" TEXT,
    "origin" "PartOrigin",
    "condition" "Condition",
    "channel" "CommissionChannel" NOT NULL DEFAULT 'ANY',
    "bps" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRunMark" (
    "key" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRunMark_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "CommissionRule_active_merchantId_idx" ON "CommissionRule"("active", "merchantId");

-- CreateIndex
CREATE INDEX "JobRunMark_createdAt_idx" ON "JobRunMark"("createdAt");

-- CreateIndex
CREATE INDEX "Offer_merchantId_lastConfirmedAt_idx" ON "Offer"("merchantId", "lastConfirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementLine_merchantOrderId_kind_key" ON "SettlementLine"("merchantOrderId", "kind");

-- ───────────────────────────── data migration

-- 1000 bps was the old column default, not a negotiated rate: those merchants move to the CommissionRule tiers.
-- Any other value was set deliberately by ops and stays as the merchant's negotiated B2C rate.
UPDATE "Merchant" SET "commissionBps" = NULL WHERE "commissionBps" = 1000;

-- Existing offers count as confirmed when they were last edited (not "now"), so freshness is honest from day one.
UPDATE "Offer" SET "lastConfirmedAt" = "updatedAt";

-- Historical orders had one rate per merchant order: copy it to each line, then put the rounding remainder on the
-- first line so Σ line commission = MerchantOrder.commissionHalalas exactly (reconciliation relies on it).
UPDATE "OrderItem" oi
SET "commissionBps" = mo."commissionBps",
    "commissionHalalas" = ((oi."lineTotalHalalas"::bigint * mo."commissionBps" + 5000) / 10000)::int
FROM "MerchantOrder" mo
WHERE mo.id = oi."merchantOrderId";

WITH s AS (
  SELECT "merchantOrderId", sum("commissionHalalas") AS c, min(id) AS first FROM "OrderItem" GROUP BY "merchantOrderId"
)
UPDATE "OrderItem" oi
SET "commissionHalalas" = oi."commissionHalalas" + (mo."commissionHalalas" - s.c)
FROM s JOIN "MerchantOrder" mo ON mo.id = s."merchantOrderId"
WHERE oi.id = s.first AND mo."commissionHalalas" <> s.c;

-- ───────────────────────────── constraints

ALTER TABLE "CommissionRule"
  ADD CONSTRAINT commission_rule_bps CHECK ("bps" >= 0 AND "bps" <= 5000),
  ADD CONSTRAINT commission_rule_validity CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validTo" > "validFrom");
ALTER TABLE "OrderItem"
  ADD CONSTRAINT item_commission_bounded CHECK ("commissionBps" >= 0 AND "commissionBps" <= 5000 AND "commissionHalalas" >= 0 AND "commissionHalalas" <= "lineTotalHalalas");
ALTER TABLE "Merchant" ADD CONSTRAINT merchant_quality_score CHECK ("qualityScore" IS NULL OR ("qualityScore" >= 0 AND "qualityScore" <= 100));
ALTER TABLE "Payment" ADD CONSTRAINT payment_fee_bounded CHECK ("feeBps" >= 0 AND "feeHalalas" >= 0 AND "feeHalalas" <= "amountHalalas");
ALTER TABLE "Settlement" ADD CONSTRAINT settlement_reserve_nonneg CHECK ("reserveHeldHalalas" >= 0 AND "reserveReleasedHalalas" >= 0);
ALTER TABLE "SettlementLine" ADD CONSTRAINT settlement_line_reserve_nonneg CHECK ("reserveHalalas" >= 0);

-- ───────────────────────────── default commission tiers (evaluation committee, member 3 §"القيمة للتاجر")
-- B2C aftermarket 10–12% (new 10%, used/refurbished 12%), B2C OEM 7% (thin margins), accessories 13%, B2B 5%.
-- The accessories rule applies once an "accessories" category exists (category ids are plain columns).
INSERT INTO "CommissionRule" ("id", "name", "origin", "condition", "categoryId", "channel", "bps", "note", "updatedAt") VALUES
  ('cr-default-aftermarket-new',    'تجاري جديد (B2C)',        'AFTERMARKET', 'NEW',         NULL,          'B2C', 1000, 'Committee default', CURRENT_TIMESTAMP),
  ('cr-default-aftermarket-used',   'تجاري مستعمل (B2C)',      'AFTERMARKET', 'USED',        NULL,          'B2C', 1200, 'Committee default', CURRENT_TIMESTAMP),
  ('cr-default-aftermarket-refurb', 'تجاري مُجدَّد (B2C)',      'AFTERMARKET', 'REFURBISHED', NULL,          'B2C', 1200, 'Committee default', CURRENT_TIMESTAMP),
  ('cr-default-oem',                'أصلي OEM (B2C)',          'OEM',         NULL,          NULL,          'B2C',  700, 'Committee default: thin OEM margins', CURRENT_TIMESTAMP),
  ('cr-default-accessories',        'إكسسوارات (B2C)',          NULL,          NULL,          'accessories', 'B2C', 1300, 'Committee default', CURRENT_TIMESTAMP),
  ('cr-default-b2b',                'ورش ومنشآت (B2B)',         NULL,          NULL,          NULL,          'B2B',  500, 'Committee default', CURRENT_TIMESTAMP);
