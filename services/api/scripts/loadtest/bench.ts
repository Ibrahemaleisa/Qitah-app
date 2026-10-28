/**
 * Catalog latency benchmark against a (synthetic, see generate.ts) scratch database. Runs the real Fastify
 * app in-process (`app.inject`: routing, validation, SQL, JSON serialisation; no network) and reports
 * p50 / p95 / p99 per scenario, then EXPLAIN (ANALYZE, BUFFERS) of the slowest SQL statement of each search
 * scenario.
 *
 *   DATABASE_URL=postgresql://qitah@127.0.0.1:5433/qitah_scale_load npm run loadtest:bench -- --runs=200 [--concurrency=1] [--out=/tmp/plans]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.PRISMA_QUERY_EVENTS = '1';
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'bench-secret-bench-secret-bench-secret-1';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'bench-payment-webhook-secret';
process.env.CARRIER_WEBHOOK_SECRET ??= 'bench-carrier-webhook-secret';
process.env.RATE_LIMIT_SCALE ??= '10000';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const RUNS = Number(args.runs ?? 200);
const WARMUP = Number(args.warmup ?? 20);
const CONCURRENCY = Number(args.concurrency ?? 1);
const OUT = args.out ?? join(process.env.TMPDIR ?? '/tmp', 'qitah-bench-plans');

type QueryEvent = { query: string; params: string; duration: number };

async function main() {
  const { buildApp } = await import('../../src/app.js');
  const { loadConfig } = await import('../../src/config.js');
  const { prisma } = await import('../../src/db.js');
  const app = await buildApp(loadConfig());

  let capture: QueryEvent[] | null = null;
  (prisma as unknown as { $on: (e: 'query', cb: (ev: QueryEvent) => void) => void }).$on('query', (ev) => {
    if (capture) capture.push({ query: ev.query, params: ev.params, duration: Number(ev.duration) });
  });

  const counts = await prisma.$queryRaw<{ products: bigint; listed: bigint; offers: bigint; fitments: bigint }[]>`
    SELECT (SELECT count(*) FROM "Product") AS products, (SELECT count(*) FROM "ProductListing" WHERE listed) AS listed,
           (SELECT count(*) FROM "Offer") AS offers, (SELECT count(*) FROM "ProductFitment") AS fitments`;
  const ids = (await prisma.$queryRaw<{ id: string }[]>`SELECT "productId" AS id FROM "ProductListing" WHERE listed ORDER BY md5("productId") LIMIT 2000`).map((r) => r.id);
  const partNumbers = (await prisma.$queryRaw<{ v: string }[]>`SELECT value AS v FROM "ProductIdentifier" ORDER BY md5(id) LIMIT 300`).map((r) => r.v);
  const vehicles = (
    await prisma.$queryRaw<{ id: string; yearFrom: number; yearTo: number; engines: string[] }[]>`SELECT id, "yearFrom", "yearTo", engines FROM "VehicleModel" WHERE id NOT LIKE 'lt-%' ORDER BY id`
  ).map((m) => ({ modelId: m.id, year: Math.min(m.yearTo, m.yearFrom + 3), engine: m.engines[0] }));
  const colloquial = ['فحمات', 'هوبات', 'فلتر زيت', 'بواجي', 'مساعدات', 'دينمو', 'قربة', 'زيت 5w30', 'لمبات', 'صدامات', 'فلتر مكيف', 'طرمبة ماء', 'بطارية', 'سيور', 'مراية'];
  const typedVehicle = ['فحمات كامري 2022', 'فلتر زيت كامري 2022', 'مساعدات هايلكس 2020', 'رديتر باترول 2019', 'لمبات تاهو 2021', 'هوبات لاند كروزر 2020'];
  let i = 0;
  const next = <T>(xs: T[]) => xs[i++ % xs.length];
  const enc = encodeURIComponent;
  const v = () => {
    const x = next(vehicles);
    return `modelId=${x.modelId}&year=${x.year}&engine=${enc(x.engine)}`;
  };

  const scenarios: { name: string; search?: boolean; url: () => string }[] = [
    { name: 'search: colloquial (no vehicle)', search: true, url: () => `/v1/catalog/search?q=${enc(next(colloquial))}&inStock=true&limit=20` },
    { name: 'search: part number', search: true, url: () => `/v1/catalog/search?q=${enc(next(partNumbers))}&inStock=true&limit=20` },
    { name: 'search: colloquial + garage vehicle (fitsOnly)', search: true, url: () => `/v1/catalog/search?q=${enc(next(colloquial))}&${v()}&fitsOnly=true&inStock=true&limit=20` },
    { name: 'search: vehicle typed in query', search: true, url: () => `/v1/catalog/search?q=${enc(next(typedVehicle))}&fitsOnly=true&inStock=true&limit=20` },
    { name: 'search: category browse + vehicle (no text)', search: true, url: () => `/v1/catalog/search?categoryId=${next(['brakes', 'filters', 'suspension', 'cooling', 'lighting'])}&${v()}&fitsOnly=true&inStock=true&limit=20` },
    { name: 'search: condition filter + price sort', search: true, url: () => `/v1/catalog/search?q=${enc(next(colloquial))}&condition=used,refurbished&sort=priceAsc&limit=20` },
    { name: 'product detail', url: () => `/v1/catalog/products/${next(ids)}` },
    { name: 'products?ids (50)', url: () => `/v1/catalog/products?ids=${Array.from({ length: 50 }, () => next(ids)).join(',')}` },
    { name: 'home (vehicle)', url: () => `/v1/catalog/home?${v()}` },
    { name: 'home (no vehicle)', url: () => '/v1/catalog/home' },
    { name: 'changes (100 ids, 1h)', url: () => `/v1/catalog/changes?since=${enc(new Date(Date.now() - 3600_000).toISOString())}&ids=${Array.from({ length: 100 }, () => next(ids)).join(',')}` },
    { name: 'reference', url: () => '/v1/catalog/reference' },
  ];

  const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
  const results: { name: string; p50: number; p95: number; p99: number; mean: number; items: number }[] = [];
  mkdirSync(OUT, { recursive: true });
  const plans: string[] = [];

  for (const s of scenarios) {
    const call = async () => {
      const url = s.url();
      const t = process.hrtime.bigint();
      const res = await app.inject({ method: 'GET', url });
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      if (res.statusCode !== 200) throw new Error(`${url} → ${res.statusCode} ${res.body.slice(0, 200)}`);
      return { ms, body: res.body };
    };
    for (let w = 0; w < WARMUP; w++) await call();
    const times: number[] = [];
    let items = 0;
    for (let r = 0; r < RUNS; r += CONCURRENCY) {
      const batch = await Promise.all(Array.from({ length: Math.min(CONCURRENCY, RUNS - r) }, call));
      for (const b of batch) {
        times.push(b.ms);
        if (s.search) items += (JSON.parse(b.body) as { items: unknown[] }).items.length;
      }
    }
    times.sort((a, b) => a - b);
    results.push({ name: s.name, p50: pct(times, 50), p95: pct(times, 95), p99: pct(times, 99), mean: times.reduce((a, b) => a + b, 0) / times.length, items: s.search ? items / times.length : NaN });

    if (s.search) {
      capture = [];
      const url = s.url();
      await app.inject({ method: 'GET', url });
      const slowest = capture.sort((a, b) => b.duration - a.duration)[0];
      capture = null;
      if (slowest) {
        const params = JSON.parse(slowest.params) as unknown[];
        const rows = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN (ANALYZE, BUFFERS) ${slowest.query}`, ...params);
        const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
        const file = join(OUT, `${s.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`);
        writeFileSync(file, `-- ${url}\n-- params ${slowest.params}\n${slowest.query}\n\n${plan}\n`);
        const exec = /Execution Time: ([\d.]+) ms/.exec(plan)?.[1];
        const top = plan.split('\n').filter((l) => /Index|Seq Scan|Bitmap/.test(l)).slice(0, 4).map((l) => l.trim().replace(/\s+\(cost=.*?\)/, '').slice(0, 110));
        plans.push(`${s.name}: slowest statement ${slowest.duration} ms, EXPLAIN ANALYZE execution ${exec} ms → ${file}\n    ${top.join('\n    ')}`);
      }
    }
  }

  const c = counts[0];
  console.log(`\nCatalog: ${Number(c.products).toLocaleString()} products (${Number(c.listed).toLocaleString()} listed), ${Number(c.offers).toLocaleString()} offers, ${Number(c.fitments).toLocaleString()} fitment rows`);
  console.log(`Runs per scenario: ${RUNS} (warm-up ${WARMUP}), concurrency ${CONCURRENCY}; in-process app.inject, times in ms\n`);
  console.log('| Scenario | p50 | p95 | p99 | mean | avg items |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const r of results) console.log(`| ${r.name} | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.p99.toFixed(1)} | ${r.mean.toFixed(1)} | ${Number.isNaN(r.items) ? '' : r.items.toFixed(1)} |`);
  console.log('\nEXPLAIN (slowest SQL per search scenario):');
  for (const p of plans) console.log(`- ${p}`);
  await app.close();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
