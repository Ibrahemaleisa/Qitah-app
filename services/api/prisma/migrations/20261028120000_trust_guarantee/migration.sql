-- Trust layer: fit guarantee (ضمان قطعة), delivered price + same-day cutoff, fair returns.

-- CreateEnum
CREATE TYPE "ShipmentPayer" AS ENUM ('CUSTOMER', 'PLATFORM', 'MERCHANT');

-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'GUARANTEE_EXPENSE';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "fitSnapshot" JSONB;

-- AlterTable
ALTER TABLE "PickupLocation" ADD COLUMN     "sameDayCutoffMinutes" INTEGER NOT NULL DEFAULT 840;
ALTER TABLE "PickupLocation" ADD CONSTRAINT "PickupLocation_sameDayCutoff_range" CHECK ("sameDayCutoffMinutes" >= 0 AND "sameDayCutoffMinutes" <= 1440);

-- AlterTable
ALTER TABLE "ReturnCase" ADD COLUMN     "guaranteed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "unopened" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "paidBy" "ShipmentPayer" NOT NULL DEFAULT 'CUSTOMER';
-- Return shipments created before this migration were handled by the merchant flow at no recorded cost.
UPDATE "Shipment" SET "paidBy" = 'MERCHANT' WHERE "direction" = 'RETURN';
