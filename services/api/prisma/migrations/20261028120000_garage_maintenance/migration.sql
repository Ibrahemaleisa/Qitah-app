-- Garage (odometer, optional trim), maintenance templates/records/reminders, mechanic reviews.

-- CreateEnum
CREATE TYPE "MechanicReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_SUGGESTED');

-- CreateEnum
CREATE TYPE "ServiceRecordSource" AS ENUM ('MANUAL', 'ORDER');

-- AlterTable
ALTER TABLE "GarageVehicle" ADD COLUMN     "odometerKm" INTEGER,
ADD COLUMN     "odometerUpdatedAt" TIMESTAMP(3),
ALTER COLUMN "trim" SET DEFAULT '';

-- CreateTable
CREATE TABLE "MechanicReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" "MechanicReviewStatus" NOT NULL DEFAULT 'PENDING',
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "decisions" JSONB,
    "mechanicNote" TEXT,
    "workshopName" TEXT,
    "workshopPhone" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MechanicReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTemplate" (
    "id" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "makeId" TEXT,
    "modelId" TEXT,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "noteAr" TEXT NOT NULL DEFAULT '',
    "noteEn" TEXT NOT NULL DEFAULT '',
    "intervalKm" INTEGER,
    "intervalMonths" INTEGER,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "components" JSONB NOT NULL DEFAULT '[]',
    "categoryIds" TEXT[],
    "keywords" TEXT[],
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MaintenanceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleServiceRecord" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "variant" TEXT,
    "doneAtKm" INTEGER,
    "doneAt" TIMESTAMP(3) NOT NULL,
    "source" "ServiceRecordSource" NOT NULL DEFAULT 'MANUAL',
    "orderItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleServiceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceReminder" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "cycleKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MechanicReview_tokenHash_key" ON "MechanicReview"("tokenHash");

-- CreateIndex
CREATE INDEX "MechanicReview_userId_createdAt_idx" ON "MechanicReview"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MechanicReview_workshopPhone_idx" ON "MechanicReview"("workshopPhone");

-- CreateIndex
CREATE INDEX "MaintenanceTemplate_serviceCode_idx" ON "MaintenanceTemplate"("serviceCode");

-- CreateIndex
CREATE INDEX "VehicleServiceRecord_vehicleId_serviceCode_doneAt_idx" ON "VehicleServiceRecord"("vehicleId", "serviceCode", "doneAt");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleServiceRecord_vehicleId_orderItemId_key" ON "VehicleServiceRecord"("vehicleId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceReminder_vehicleId_serviceCode_cycleKey_key" ON "MaintenanceReminder"("vehicleId", "serviceCode", "cycleKey");

-- AddForeignKey
ALTER TABLE "VehicleServiceRecord" ADD CONSTRAINT "VehicleServiceRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "GarageVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceReminder" ADD CONSTRAINT "MaintenanceReminder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "GarageVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Odometer and service kilometres are never negative.
ALTER TABLE "GarageVehicle" ADD CONSTRAINT "GarageVehicle_odometerKm_check" CHECK ("odometerKm" IS NULL OR ("odometerKm" >= 0 AND "odometerKm" <= 3000000));
ALTER TABLE "VehicleServiceRecord" ADD CONSTRAINT "VehicleServiceRecord_doneAtKm_check" CHECK ("doneAtKm" IS NULL OR ("doneAtKm" >= 0 AND "doneAtKm" <= 3000000));
