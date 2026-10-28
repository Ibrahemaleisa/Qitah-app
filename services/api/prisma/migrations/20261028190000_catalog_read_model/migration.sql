-- Catalog read model (scale): one ProductListing row per product, derived from the offers that pass
-- `publicOfferWhere` (services/catalog.ts). Kept current synchronously by services/listings.ts in the same
-- transaction as offer / stock / merchant / location writes; worker sweep + `npm run db:backfill-listings`
-- are the safety net. Search, home, snapshot and /v1/catalog/changes read it.

-- CreateTable
CREATE TABLE "ProductListing" (
    "productId" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL,
    "listed" BOOLEAN NOT NULL DEFAULT false,
    "categoryId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "origin" "PartOrigin" NOT NULL,
    "universal" BOOLEAN NOT NULL DEFAULT false,
    "hasCatalogFitment" BOOLEAN NOT NULL DEFAULT false,
    "offerCount" INTEGER NOT NULL DEFAULT 0,
    "inStockOfferCount" INTEGER NOT NULL DEFAULT 0,
    "totalAvailable" INTEGER NOT NULL DEFAULT 0,
    "minPriceHalalas" INTEGER,
    "minOfferPriceHalalas" INTEGER,
    "minInStockPriceHalalas" INTEGER,
    "minDispatchDays" INTEGER,
    "minInStockDispatchDays" INTEGER,
    "conditions" "Condition"[],
    "inStockConditions" "Condition"[],
    "merchantIds" TEXT[],
    "originCities" TEXT[],
    "offers" JSONB NOT NULL DEFAULT '[]',
    "offersHash" TEXT NOT NULL DEFAULT '',
    "catalogFitKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sellerFitKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nextChangeAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductListing_pkey" PRIMARY KEY ("productId")
);

-- CreateIndex
CREATE INDEX "ProductListing_listed_categoryId_offerCount_idx" ON "ProductListing"("listed", "categoryId", "offerCount" DESC);

-- CreateIndex
CREATE INDEX "ProductListing_listed_universal_categoryId_offerCount_idx" ON "ProductListing"("listed", "universal", "categoryId", "offerCount" DESC);

-- CreateIndex
CREATE INDEX "ProductListing_updatedAt_idx" ON "ProductListing"("updatedAt");

-- CreateIndex
CREATE INDEX "ProductListing_nextChangeAt_idx" ON "ProductListing"("nextChangeAt");

-- CreateIndex
CREATE INDEX "ProductListing_merchantIds_idx" ON "ProductListing" USING GIN ("merchantIds");

-- CreateIndex
CREATE INDEX "ProductListing_catalogFitKeys_idx" ON "ProductListing" USING GIN ("catalogFitKeys");

-- CreateIndex
CREATE INDEX "ProductListing_sellerFitKeys_idx" ON "ProductListing" USING GIN ("sellerFitKeys");

-- Initial population so search keeps working the moment this migration lands. It mirrors publicOfferWhere as
-- of this migration (PUBLIC + ACTIVE offer, APPROVED merchant, active location, confirmed within the default
-- FRESHNESS_HIDE_DAYS = 21; stale after FRESHNESS_STALE_DAYS = 7; timestamps are UTC). offersHash is left empty on
-- purpose: run `npm run db:backfill-listings` after deploying; it re-derives every row through the
-- application's publicOfferWhere (the source of truth) and fills the hash.
INSERT INTO "ProductListing" (
    "productId", "status", "listed", "categoryId", "brand", "origin", "universal", "hasCatalogFitment",
    "offerCount", "inStockOfferCount", "totalAvailable", "minPriceHalalas", "minOfferPriceHalalas", "minInStockPriceHalalas",
    "minDispatchDays", "minInStockDispatchDays", "conditions", "inStockConditions", "merchantIds", "originCities", "offers", "offersHash",
    "catalogFitKeys", "sellerFitKeys", "nextChangeAt", "updatedAt")
SELECT
    p.id, p.status, p.status = 'ACTIVE' AND coalesce(o.n, 0) > 0, p."categoryId", p.brand, p.origin, p."universalNoteAr" IS NOT NULL,
    EXISTS (SELECT 1 FROM "ProductFitment" f WHERE f."productId" = p.id AND f.source = 'CATALOG'),
    coalesce(o.n, 0), coalesce(o.n_in, 0), coalesce(o.avail, 0), coalesce(o.min_in, o.min_any), o.min_any, o.min_in,
    o.disp_any, o.disp_in, coalesce(o.conds, '{}'), coalesce(o.conds_in, '{}'), coalesce(o.merchants, '{}'), coalesce(o.cities, '{}'),
    coalesce(o.summary, '[]'::jsonb), '',
    coalesce((SELECT array_agg(k.key ORDER BY k.key COLLATE "C") FROM (
        SELECT 'm|' || f."modelId" AS key FROM "ProductFitment" f WHERE f."productId" = p.id AND f.source = 'CATALOG'
        UNION SELECT 'k|' || vm."makeId" FROM "ProductFitment" f JOIN "VehicleModel" vm ON vm.id = f."modelId" WHERE f."productId" = p.id AND f.source = 'CATALOG'
        UNION SELECT 'y|' || f."modelId" || '|' || y FROM "ProductFitment" f, generate_series(f."yearFrom", f."yearTo") y WHERE f."productId" = p.id AND f.source = 'CATALOG' AND cardinality(f.engines) = 0
        UNION SELECT 'e|' || f."modelId" || '|' || y || '|' || e FROM "ProductFitment" f, generate_series(f."yearFrom", f."yearTo") y, unnest(f.engines) e WHERE f."productId" = p.id AND f.source = 'CATALOG'
    ) k), '{}'),
    coalesce((SELECT array_agg(k.key ORDER BY k.key COLLATE "C") FROM (
        SELECT 'm|' || f."modelId" AS key FROM "ProductFitment" f WHERE f."productId" = p.id AND f.source = 'SELLER'
        UNION SELECT 'k|' || vm."makeId" FROM "ProductFitment" f JOIN "VehicleModel" vm ON vm.id = f."modelId" WHERE f."productId" = p.id AND f.source = 'SELLER'
        UNION SELECT 'y|' || f."modelId" || '|' || y FROM "ProductFitment" f, generate_series(f."yearFrom", f."yearTo") y WHERE f."productId" = p.id AND f.source = 'SELLER' AND cardinality(f.engines) = 0
        UNION SELECT 'e|' || f."modelId" || '|' || y || '|' || e FROM "ProductFitment" f, generate_series(f."yearFrom", f."yearTo") y, unnest(f.engines) e WHERE f."productId" = p.id AND f.source = 'SELLER'
    ) k), '{}'),
    o.next_change, CURRENT_TIMESTAMP
FROM "Product" p
LEFT JOIN LATERAL (
    SELECT count(*) AS n,
        count(*) FILTER (WHERE x.a > 0) AS n_in,
        sum(x.a) AS avail,
        min(x."priceHalalas") AS min_any,
        min(x."priceHalalas") FILTER (WHERE x.a > 0) AS min_in,
        min(x."dispatchDaysMin") AS disp_any,
        min(x."dispatchDaysMin") FILTER (WHERE x.a > 0) AS disp_in,
        min(CASE WHEN x."lastConfirmedAt" + interval '7 days' > (now() AT TIME ZONE 'UTC') THEN x."lastConfirmedAt" + interval '7 days'
                 ELSE x."lastConfirmedAt" + interval '21 days' END) AS next_change,
        array_agg(DISTINCT x.condition) AS conds,
        array_agg(DISTINCT x.condition) FILTER (WHERE x.a > 0) AS conds_in,
        array_agg(DISTINCT x."merchantId" ORDER BY x."merchantId") AS merchants,
        array_agg(DISTINCT x.city ORDER BY x.city) AS cities,
        jsonb_agg(jsonb_build_object('id', x.id, 'm', x."merchantId", 'c', lower(x.condition::text), 'p', x."priceHalalas", 'a', x.a, 'd', x."dispatchDaysMin") ORDER BY x.id) AS summary
    FROM (
        SELECT ofr.id, ofr."merchantId", ofr.condition, ofr."priceHalalas", ofr."dispatchDaysMin", ofr."lastConfirmedAt", l.city,
            greatest(0, coalesce(inv."onHand" - inv.reserved, 0))::int AS a
        FROM "Offer" ofr
        JOIN "Merchant" m ON m.id = ofr."merchantId"
        JOIN "PickupLocation" l ON l.id = ofr."locationId"
        LEFT JOIN "InventoryLevel" inv ON inv."offerId" = ofr.id
        WHERE ofr."productId" = p.id AND ofr.visibility = 'PUBLIC' AND ofr.status = 'ACTIVE' AND m.status = 'APPROVED' AND l.active
            AND ofr."lastConfirmedAt" >= (now() AT TIME ZONE 'UTC') - interval '21 days'
    ) x
) o ON TRUE
ON CONFLICT ("productId") DO NOTHING;
