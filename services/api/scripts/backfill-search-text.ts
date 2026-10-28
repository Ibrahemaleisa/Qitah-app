/**
 * Rebuilds Product.searchText for every product (names, keywords, part numbers + the search lexicon's
 * concept tokens and colloquial terms). Run after deploying the *_search_indexes migration and whenever
 * src/search/lexicon.ts changes. Idempotent; only rows whose text changed are written.
 *
 * Usage: npm run db:backfill-search
 */
import { prisma } from '../src/db.js';
import { refreshSearchText } from '../src/services/catalog.js';

const BATCH = 200;

async function main() {
  let cursor: string | undefined;
  let scanned = 0;
  let changed = 0;
  for (;;) {
    const rows = await prisma.product.findMany({ select: { id: true }, orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (!rows.length) break;
    for (const r of rows) if (await refreshSearchText(prisma, r.id)) changed++;
    scanned += rows.length;
    cursor = rows[rows.length - 1].id;
  }
  console.log(`searchText backfill: ${changed} of ${scanned} products updated`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
