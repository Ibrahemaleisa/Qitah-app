-- Integrity guards Prisma cannot express. These protect against overselling and
-- invalid money values even if application code is wrong.
ALTER TABLE "InventoryLevel"
  ADD CONSTRAINT inventory_on_hand_nonneg CHECK ("onHand" >= 0),
  ADD CONSTRAINT inventory_reserved_nonneg CHECK ("reserved" >= 0),
  ADD CONSTRAINT inventory_reserved_le_on_hand CHECK ("reserved" <= "onHand");

ALTER TABLE "InventoryReservation" ADD CONSTRAINT reservation_qty_pos CHECK ("quantity" > 0);
ALTER TABLE "CartItem" ADD CONSTRAINT cart_qty_range CHECK ("quantity" > 0 AND "quantity" <= 50);

ALTER TABLE "Offer"
  ADD CONSTRAINT offer_price_pos CHECK ("priceHalalas" > 0),
  ADD CONSTRAINT offer_compare_at CHECK ("compareAtHalalas" IS NULL OR "compareAtHalalas" >= "priceHalalas"),
  ADD CONSTRAINT offer_dispatch CHECK ("dispatchDaysMin" >= 0 AND "dispatchDaysMax" >= "dispatchDaysMin"),
  ADD CONSTRAINT offer_warranty CHECK ("warrantyMonths" >= 0);

ALTER TABLE "Product"
  ADD CONSTRAINT product_dims_pos CHECK ("weightGrams" > 0 AND "lengthCm" > 0 AND "widthCm" > 0 AND "heightCm" > 0);

ALTER TABLE "ProductFitment" ADD CONSTRAINT fitment_years CHECK ("yearTo" >= "yearFrom");

ALTER TABLE "Merchant" ADD CONSTRAINT merchant_commission CHECK ("commissionBps" >= 0 AND "commissionBps" <= 5000);

ALTER TABLE "Order"
  ADD CONSTRAINT order_money_nonneg CHECK ("itemsHalalas" >= 0 AND "shippingHalalas" >= 0 AND "discountHalalas" >= 0 AND "vatHalalas" >= 0),
  ADD CONSTRAINT order_total_consistent CHECK ("totalHalalas" = "itemsHalalas" + "shippingHalalas" - "discountHalalas"),
  ADD CONSTRAINT order_refund_bounded CHECK ("refundedHalalas" >= 0 AND "refundedHalalas" <= "totalHalalas");

ALTER TABLE "MerchantOrder"
  ADD CONSTRAINT mo_money_nonneg CHECK ("itemsHalalas" >= 0 AND "shippingHalalas" >= 0 AND "commissionHalalas" >= 0);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT item_qty_pos CHECK ("quantity" > 0),
  ADD CONSTRAINT item_total_consistent CHECK ("lineTotalHalalas" = "unitPriceHalalas" * "quantity");

ALTER TABLE "Payment"
  ADD CONSTRAINT payment_amounts CHECK ("amountHalalas" > 0 AND "capturedHalalas" >= 0 AND "capturedHalalas" <= "amountHalalas"
    AND "refundedHalalas" >= 0 AND "refundedHalalas" <= "capturedHalalas");

ALTER TABLE "Refund" ADD CONSTRAINT refund_amount_pos CHECK ("amountHalalas" > 0);
ALTER TABLE "ReturnItem" ADD CONSTRAINT return_item_qty_pos CHECK ("quantity" > 0);

-- Ledger rows are append-only.
CREATE OR REPLACE FUNCTION qitah_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION qitah_forbid_mutation();
