-- Search v1 (/v1/catalog/search): trigram matching on Product.searchText and part-number prefixes.
-- Indexes and extension only; no table changes.
-- Product.searchText itself is rebuilt by application code (it carries the search lexicon's concept
-- tokens and colloquial terms): run `npm run db:backfill-search` after deploying (idempotent, batched).
-- On a large production table, prefer creating these two indexes CONCURRENTLY by hand first;
-- IF NOT EXISTS lets this migration then pass without locking writes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_searchText_trgm_idx" ON "Product" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProductIdentifier_normalized_pattern_idx" ON "ProductIdentifier"("normalized" text_pattern_ops);
