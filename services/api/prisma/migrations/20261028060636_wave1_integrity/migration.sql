-- AlterTable
ALTER TABLE "ReturnCase" ADD COLUMN     "inspectedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AuditEvent_entityId_idx" ON "AuditEvent"("entityId");

-- CreateIndex
CREATE INDEX "CheckoutPlan_expiresAt_idx" ON "CheckoutPlan"("expiresAt");

-- CreateIndex
CREATE INDEX "DomainEvent_customerId_id_idx" ON "DomainEvent"("customerId", "id");

-- CreateIndex
CREATE INDEX "LedgerEntry_merchantOrderId_account_idx" ON "LedgerEntry"("merchantOrderId", "account");

-- CreateIndex
CREATE INDEX "MerchantOrder_slaBreached_status_idx" ON "MerchantOrder"("slaBreached", "status");

-- CreateIndex
CREATE INDEX "Order_status_paymentExpiresAt_idx" ON "Order"("status", "paymentExpiresAt");

-- CreateIndex
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- CreateIndex
CREATE INDEX "ShippingQuote_expiresAt_idx" ON "ShippingQuote"("expiresAt");

-- Merchant-scoped realtime streams filter on merchantIds (array containment).
CREATE INDEX IF NOT EXISTS "DomainEvent_merchantIds_gin" ON "DomainEvent" USING GIN ("merchantIds");
