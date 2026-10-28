/**
 * Rebuilds the ProductListing read model for every product (one row per product, derived from offers that
 * pass `publicOfferWhere`). Run once after deploying the *_catalog_read_model migration, and any time the
 * read model is suspected to have drifted. Idempotent: rows are only written when a derived value changed,
 * so a second run reports 0 changes. Each batch runs in its own short transaction (row locks, then read).
 *
 * Usage: npm run db:backfill-listings [-- --batch=1000]
 */
import { prisma } from '../src/db.js';
import { rebuildAllListings } from '../src/services/listings.js';

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--batch='));
  const batch = arg ? Math.max(50, Math.min(5000, Number(arg.split('=')[1]) || 1000)) : 1000;
  const started = Date.now();
  let lastLog = 0;
  const r = await rebuildAllListings({
    batch,
    onBatch: (scanned, changed) => {
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        console.log(`  … ${scanned} products scanned, ${changed} listings changed`);
      }
    },
  });
  console.log(`listing backfill: ${r.changed} of ${r.scanned} listings changed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
