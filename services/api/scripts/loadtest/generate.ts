/**
 * Synthetic catalog for load tests: products with realistic Arabic/English names, brands, manufacturer and
 * OEM part numbers, vehicle fitment (catalog- and seller-sourced, engine-restricted, by-specification),
 * merchants with pickup locations across Saudi cities, and 1–5 offers per product with stock (some sold out,
 * stale or hidden by the freshness policy (≈70% confirmed within a week, 20% stale, 10% unconfirmed > 21 days),
 * paused, used/refurbished, a few suspended merchants). Then derives the ProductListing read model through
 * the application code (timed: that is the backfill throughput) and ANALYZEs.
 *
 * Run it ONLY against a scratch database that already has migrations + the sandbox seed (categories,
 * makes/models, staff): the generator refuses databases whose name does not look like a scratch DB.
 *
 *   createdb -h 127.0.0.1 -p 5433 -U qitah qitah_scale_load
 *   export DATABASE_URL=postgresql://qitah@127.0.0.1:5433/qitah_scale_load
 *   npx prisma migrate deploy && npx tsx prisma/seed.ts --force
 *   npm run loadtest:generate -- --products=200000      # or --products=1000000
 *   npm run loadtest:bench
 *
 * Generated rows use the "lt-" id prefix; `--reset` deletes previous synthetic rows first. Nothing generated
 * is committed to the repository.
 */

import { prisma } from '../../src/db.js';
import { normalizePartNumber } from '../../src/lib/text.js';
import { buildSearchText } from '../../src/services/catalog.js';
import { rebuildAllListings } from '../../src/services/listings.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const PRODUCTS = Number(args.products ?? 200_000);
const BATCH = Number(args.batch ?? 5000);
const SEED = Number(args.seed ?? 42);
const MERCHANTS = Number(args.merchants ?? Math.max(60, Math.round(PRODUCTS / 1000)));
const EXTRA_MODELS = Number(args.models ?? 120);

// ───────────────────────────────────────────── deterministic randomness

let state = SEED >>> 0;
function rnd() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
const ALNUM = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const code = (n: number) => Array.from({ length: n }, () => ALNUM[int(0, ALNUM.length - 1)]).join('');
const digits = (n: number) => Array.from({ length: n }, () => String(int(0, 9))).join('');

// ───────────────────────────────────────────── vocabulary

type PartType = {
  categoryId: string;
  art: string;
  ar: string[];
  en: string;
  keywords: string[];
  variants: [string, string][];
  /** Share of products of this type sold "by specification" (no vehicle fitment). */
  universal: number;
  price: [number, number];
  phys: { w: number; d: [number, number, number]; h: 'STANDARD' | 'FRAGILE' | 'OVERSIZED' | 'HAZMAT' };
};

const TYPES: PartType[] = [
  { categoryId: 'brakes', art: 'pads', ar: ['فحمات فرامل', 'فحمات بريك', 'تيل فرامل'], en: 'Brake pads', keywords: ['فحمات', 'brake pads', 'تيل'], variants: [['أمامية', 'front'], ['خلفية', 'rear'], ['سيراميك أمامية', 'ceramic front'], ['شبه معدنية', 'semi-metallic']], universal: 0, price: [9000, 45000], phys: { w: 2200, d: [20, 15, 8], h: 'STANDARD' } },
  { categoryId: 'brakes', art: 'rotor', ar: ['هوب فرامل', 'ديسك فرامل', 'قرص فرامل'], en: 'Brake rotor', keywords: ['هوب', 'ديسك', 'rotor'], variants: [['أمامي', 'front'], ['خلفي', 'rear'], ['مخدد أمامي', 'slotted front'], ['مهوّى', 'vented']], universal: 0, price: [18000, 90000], phys: { w: 7500, d: [32, 32, 8], h: 'STANDARD' } },
  { categoryId: 'filters', art: 'oilFilter', ar: ['فلتر زيت'], en: 'Oil filter', keywords: ['فلتر زيت', 'oil filter'], variants: [['أصلي', 'genuine'], ['عالي التدفق', 'high-flow'], ['سبين أون', 'spin-on'], ['خرطوشة', 'cartridge']], universal: 0, price: [1800, 9000], phys: { w: 400, d: [12, 10, 10], h: 'STANDARD' } },
  { categoryId: 'filters', art: 'airFilter', ar: ['فلتر هواء', 'فلتر هواء المحرك'], en: 'Air filter', keywords: ['فلتر هواء', 'air filter'], variants: [['قياسي', 'standard'], ['قطني قابل للغسيل', 'washable cotton'], ['أداء عالي', 'performance']], universal: 0, price: [3500, 18000], phys: { w: 600, d: [35, 25, 6], h: 'STANDARD' } },
  { categoryId: 'filters', art: 'airFilter', ar: ['فلتر مكيف', 'فلتر تكييف'], en: 'Cabin air filter', keywords: ['فلتر مكيف', 'cabin filter'], variants: [['كربون نشط', 'activated carbon'], ['قياسي', 'standard'], ['مضاد للبكتيريا', 'antibacterial']], universal: 0, price: [2500, 12000], phys: { w: 300, d: [25, 20, 4], h: 'STANDARD' } },
  { categoryId: 'oils', art: 'oil', ar: ['زيت محرك', 'زيت مكينة'], en: 'Engine oil', keywords: ['زيت', 'engine oil'], variants: [['5W-30 تخليقي 4 لتر', '5W-30 synthetic 4L'], ['0W-20 تخليقي 4 لتر', '0W-20 synthetic 4L'], ['10W-40 نصف تخليقي', '10W-40 semi-synthetic'], ['5W-40 ديزل', '5W-40 diesel']], universal: 1, price: [6000, 32000], phys: { w: 4600, d: [28, 18, 12], h: 'STANDARD' } },
  { categoryId: 'oils', art: 'oil', ar: ['سائل تبريد', 'ماء رديتر'], en: 'Coolant', keywords: ['ماء رديتر', 'coolant'], variants: [['أخضر 4 لتر', 'green 4L'], ['وردي طويل الأمد', 'pink long-life'], ['مركز جالون', 'concentrate 1 gal']], universal: 1, price: [2500, 9000], phys: { w: 4200, d: [25, 15, 10], h: 'STANDARD' } },
  { categoryId: 'engine', art: 'sparkPlug', ar: ['بواجي', 'شمعات احتراق', 'بلكات'], en: 'Spark plugs', keywords: ['بواجي', 'spark plugs'], variants: [['إيريديوم طقم 4', 'iridium set of 4'], ['بلاتينيوم طقم 6', 'platinum set of 6'], ['نيكل', 'nickel']], universal: 0.15, price: [4000, 30000], phys: { w: 300, d: [15, 10, 5], h: 'STANDARD' } },
  { categoryId: 'engine', art: 'belt', ar: ['سير مكينة', 'سير دينمو'], en: 'Drive belt', keywords: ['سير', 'belt'], variants: [['متعدد الأخاديد', 'serpentine'], ['سير تايمن', 'timing belt'], ['طقم سير مع شداد', 'belt kit with tensioner']], universal: 0, price: [4000, 60000], phys: { w: 500, d: [25, 25, 4], h: 'STANDARD' } },
  { categoryId: 'suspension', art: 'shock', ar: ['مساعد', 'ممتص صدمات'], en: 'Shock absorber', keywords: ['مساعد', 'shock'], variants: [['أمامي', 'front'], ['خلفي', 'rear'], ['غازي أمامي يمين', 'gas front right'], ['زيتي خلفي', 'oil rear']], universal: 0, price: [15000, 120000], phys: { w: 4200, d: [60, 12, 12], h: 'STANDARD' } },
  { categoryId: 'electrical', art: 'battery', ar: ['بطارية', 'بطارية سيارة'], en: 'Battery', keywords: ['بطارية', 'battery'], variants: [['70 أمبير', '70Ah'], ['100 أمبير', '100Ah'], ['AGM 80 أمبير', 'AGM 80Ah'], ['55 أمبير', '55Ah']], universal: 0.6, price: [25000, 95000], phys: { w: 19000, d: [28, 18, 20], h: 'HAZMAT' } },
  { categoryId: 'electrical', art: 'alternator', ar: ['دينمو', 'دينامو'], en: 'Alternator', keywords: ['دينمو', 'alternator'], variants: [['جديد', 'new'], ['مجدد', 'remanufactured'], ['150 أمبير', '150A']], universal: 0, price: [60000, 280000], phys: { w: 6500, d: [25, 20, 20], h: 'STANDARD' } },
  { categoryId: 'lighting', art: 'headlight', ar: ['شمعة أمامية', 'كشاف أمامي', 'سطب خلفي'], en: 'Headlight', keywords: ['شمعة', 'headlight', 'كشاف'], variants: [['يمين', 'right'], ['يسار', 'left'], ['LED يمين', 'LED right'], ['زينون يسار', 'xenon left']], universal: 0, price: [30000, 250000], phys: { w: 4000, d: [60, 35, 30], h: 'FRAGILE' } },
  { categoryId: 'lighting', art: 'headlight', ar: ['لمبة', 'لمبات'], en: 'Bulb', keywords: ['لمبة', 'bulb'], variants: [['H11 LED', 'H11 LED'], ['H4 هالوجين', 'H4 halogen'], ['D2S زينون', 'D2S xenon'], ['T10 LED', 'T10 LED']], universal: 0.9, price: [1500, 25000], phys: { w: 200, d: [10, 8, 5], h: 'FRAGILE' } },
  { categoryId: 'cooling', art: 'radiator', ar: ['رديتر', 'راديتر', 'قربة ماء'], en: 'Radiator', keywords: ['رديتر', 'radiator'], variants: [['ألمنيوم', 'aluminium'], ['نحاس', 'copper'], ['مع مروحة', 'with fan']], universal: 0, price: [40000, 260000], phys: { w: 9000, d: [75, 50, 8], h: 'FRAGILE' } },
  { categoryId: 'cooling', art: 'pump', ar: ['طرمبة ماء', 'مضخة ماء'], en: 'Water pump', keywords: ['طرمبة ماء', 'water pump'], variants: [['مع جوان', 'with gasket'], ['كهربائية', 'electric'], ['قياسية', 'standard']], universal: 0, price: [12000, 90000], phys: { w: 3000, d: [25, 20, 18], h: 'STANDARD' } },
  { categoryId: 'body', art: 'mirror', ar: ['مراية جانبية', 'مرايه'], en: 'Side mirror', keywords: ['مراية', 'mirror'], variants: [['يمين كهربائية', 'right power'], ['يسار مع إشارة', 'left with signal'], ['يمين مدفأة', 'right heated']], universal: 0, price: [20000, 140000], phys: { w: 1800, d: [35, 25, 20], h: 'FRAGILE' } },
  { categoryId: 'body', art: 'bumper', ar: ['صدام', 'دعامية'], en: 'Bumper', keywords: ['صدام', 'bumper'], variants: [['أمامي', 'front'], ['خلفي', 'rear'], ['أمامي مع فتحات ضباب', 'front with fog holes']], universal: 0, price: [35000, 220000], phys: { w: 8000, d: [180, 50, 40], h: 'OVERSIZED' } },
];

const BRANDS: [string, string, boolean][] = [
  ['Toyota Genuine', 'TG', true], ['Nissan Genuine', 'NG', true], ['Hyundai Mobis', 'HM', true], ['Motorcraft', 'MC', true], ['ACDelco', 'AC', true], ['Lexus Genuine', 'LG', true],
  ['Kia Genuine', 'KG', true], ['GM Genuine', 'GM', true], ['Denso', 'DN', false], ['Bosch', 'BS', false], ['NGK', 'NK', false], ['Brembo', 'BR', false], ['Akebono', 'AK', false],
  ['KYB', 'KY', false], ['Monroe', 'MN', false], ['Mann-Filter', 'MF', false], ['Mahle', 'MH', false], ['Valeo', 'VL', false], ['Gates', 'GT', false], ['Dayco', 'DY', false],
  ['Torvik', 'TRV', false], ['Kanzen', 'KZ', false], ['Sakura', 'SK', false], ['Aisin', 'AS', false], ['Hella', 'HL', false], ['Philips', 'PH', false], ['Osram', 'OS', false],
  ['Varta', 'VT', false], ['Amaron', 'AM', false], ['Mobil 1', 'MB', false], ['Castrol', 'CS', false], ['Shell Helix', 'SH', false], ['Petromin', 'PT', false], ['TYC', 'TY', false],
  ['Depo', 'DP', false], ['Nissens', 'NS', false], ['Koyorad', 'KR', false], ['GMB', 'GB', false], ['Febi', 'FB', false], ['TRW', 'TW', false],
];
const CITIES = ['riyadh', 'riyadh', 'riyadh', 'jeddah', 'jeddah', 'dammam', 'khobar', 'makkah', 'madinah'];
const SHOP_AR = ['النخبة', 'الأصيل', 'المدينة', 'الشرق', 'السريع', 'الوفاء', 'الأمانة', 'الخليج', 'النجم', 'الصفوة', 'الجزيرة', 'الرواد'];
const SHOP_EN = ['Elite', 'Aseel', 'City', 'East', 'Express', 'Wafa', 'Amana', 'Gulf', 'Star', 'Safwa', 'Jazeera', 'Pioneers'];

// ───────────────────────────────────────────── helpers

function assertScratch() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const db = url.pathname.slice(1);
  if (!/(load|bench|scratch|_test)/.test(db) && !('i-know' in args)) throw new Error(`Refusing to generate into "${db}": use a scratch database (name containing load/bench/scratch/_test)`);
  return db;
}

async function insertRows(table: string, columns: string[], types: string[], rows: unknown[][]) {
  if (!rows.length) return;
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const arrays = columns.map((_, i) => rows.map((r) => r[i]));
  // unnest() of parallel 1-D arrays; array-valued columns travel as '|'-joined text and are split in SQL.
  const select = columns.map((c, i) => (types[i].endsWith('[]') ? `CASE WHEN c${i} = '' THEN '{}'::${types[i]} ELSE string_to_array(c${i}, '|')::${types[i]} END` : `c${i}::${types[i]}`)).join(', ');
  const params = columns.map((_, i) => `$${i + 1}::${types[i].endsWith('[]') || types[i] === 'jsonb' || types[i].startsWith('"') ? 'text' : types[i]}[]`).join(', ');
  const aliases = columns.map((_, i) => `c${i}`).join(', ');
  await prisma.$executeRawUnsafe(`INSERT INTO "${table}" (${cols}) SELECT ${select} FROM unnest(${params}) AS t(${aliases})`, ...arrays);
}

// ───────────────────────────────────────────── generation

async function main() {
  const db = assertScratch();
  const categories = await prisma.category.findMany();
  if (categories.length < 9) throw new Error('Run migrations + `npx tsx prisma/seed.ts --force` on this database first (categories / makes / models).');
  const catById = new Map(categories.map((c) => [c.id, c]));
  if ('reset' in args) {
    console.log('removing previous synthetic rows…');
    await prisma.$executeRawUnsafe(`DELETE FROM "InventoryLevel" WHERE "offerId" LIKE 'lt-%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Offer" WHERE id LIKE 'lt-%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "ProductListing" WHERE "productId" LIKE 'lt-%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Product" WHERE id LIKE 'lt-%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "PickupLocation" WHERE id LIKE 'lt-%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Merchant" WHERE id LIKE 'lt-%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM "VehicleModel" WHERE id LIKE 'lt-%'`);
  }
  const started = Date.now();
  console.log(`generating ${PRODUCTS.toLocaleString()} products, ${MERCHANTS} merchants, +${EXTRA_MODELS} models into ${db} (seed ${SEED})`);

  // Extra vehicle models so fitment spreads like a real catalog; the seeded (popular) models keep ~45% of it.
  const makes = await prisma.vehicleMake.findMany({ include: { models: true } });
  const extra = Array.from({ length: EXTRA_MODELS }, (_, i) => {
    const make = makes[i % makes.length];
    const from = int(2005, 2020);
    return { id: `lt-model-${i}`, makeId: make.id, nameAr: `طراز ${make.nameAr} ${i}`, nameEn: `${make.nameEn} Model ${i}`, yearFrom: from, yearTo: Math.min(2025, from + int(4, 12)), trims: ['Base'], engines: [`${int(14, 50) / 10}L I4`, `${int(25, 57) / 10}L V6`] };
  });
  await prisma.vehicleModel.createMany({ data: extra, skipDuplicates: true });
  const popular = makes.flatMap((m) => m.models.map((x) => ({ ...x, makeNameAr: m.nameAr })));
  const models = [...popular.map((m) => ({ ...m, weight: 3 })), ...extra.map((m) => ({ ...m, weight: 0.17 }))];
  const totalWeight = models.reduce((s, m) => s + m.weight, 0);
  const pickModel = () => {
    let r = rnd() * totalWeight;
    for (const m of models) if ((r -= m.weight) <= 0) return m;
    return models[models.length - 1];
  };

  // Merchants + one or two pickup locations each; ~3% suspended (their offers must never be public).
  const merchants = Array.from({ length: MERCHANTS }, (_, i) => {
    const city = pick(CITIES);
    return {
      id: `lt-m-${i}`, legalName: `Load Test Spares ${i} Est.`, displayNameAr: `${pick(SHOP_AR)} لقطع الغيار ${i}`, displayNameEn: `${pick(SHOP_EN)} Spares ${i}`, crNumber: `77${String(i).padStart(8, '0')}`,
      city, contactEmail: `m${i}@load.qitah.test`, contactPhone: `+9665${String(70000000 + i)}`, status: (chance(0.03) ? 'SUSPENDED' : 'APPROVED') as 'APPROVED', approvedAt: new Date(),
    };
  });
  await prisma.merchant.createMany({ data: merchants, skipDuplicates: true });
  const locations = merchants.flatMap((m, i) =>
    Array.from({ length: chance(0.3) ? 2 : 1 }, (_, k) => ({ id: `lt-loc-${i}-${k}`, merchantId: m.id, name: `فرع ${k + 1}`, city: k ? pick(CITIES) : m.city, district: 'الصناعية', street: `شارع ${int(1, 90)}`, contactPhone: `+9665${String(80000000 + i * 3 + k)}`, active: !chance(0.02) })),
  );
  await prisma.pickupLocation.createMany({ data: locations, skipDuplicates: true });
  const locsByMerchant = new Map<string, typeof locations>();
  for (const l of locations) locsByMerchant.set(l.merchantId, [...(locsByMerchant.get(l.merchantId) ?? []), l]);

  let offersTotal = 0;
  let fitTotal = 0;
  for (let start = 0; start < PRODUCTS; start += BATCH) {
    const n = Math.min(BATCH, PRODUCTS - start);
    const products: unknown[][] = [];
    const identifiers: unknown[][] = [];
    const fitments: unknown[][] = [];
    const offers: unknown[][] = [];
    const inventory: unknown[][] = [];
    const now = new Date();
    for (let k = 0; k < n; k++) {
      const idx = start + k;
      const id = `lt-${String(idx).padStart(7, '0')}`;
      const t = pick(TYPES);
      const [brand, prefix, oem] = pick(BRANDS);
      const [vAr, vEn] = pick(t.variants);
      const universal = chance(t.universal);
      const fit = universal ? [] : Array.from({ length: chance(0.55) ? 1 : int(2, 4) }, () => pickModel());
      const lead = fit[0];
      const typeAr = pick(t.ar);
      const series = code(3);
      const nameAr = lead ? `${typeAr} ${vAr} — ${lead.nameAr} ${series}` : `${typeAr} ${vAr} ${series}`;
      const nameEn = lead ? `${t.en} ${vEn} — ${lead.nameEn} ${series}` : `${t.en} ${vEn} ${series}`;
      const partNumber = `${prefix}-${digits(int(4, 6))}${code(int(0, 2))}`;
      const oemRefs = oem ? [] : Array.from({ length: int(0, 2) }, () => `${digits(5)}-${code(5)}`);
      const keywords = [...t.keywords, ...(lead ? [lead.nameAr, lead.nameEn.toLowerCase()] : [])];
      const cat = catById.get(t.categoryId)!;
      const searchText = buildSearchText({ nameAr, nameEn, brand, keywords, partNumber, identifiers: oemRefs, categoryNames: [cat.nameAr, cat.nameEn], categoryId: t.categoryId, art: t.art });
      const created = new Date(now.getTime() - (PRODUCTS - idx) * 1000).toISOString();
      products.push([
        id, nameAr, nameEn, `${nameAr}. بيانات تجريبية لاختبار الحمل.`, `${nameEn}. Synthetic load-test data.`, t.categoryId, brand, oem ? 'OEM' : 'AFTERMARKET', partNumber, t.art, keywords.join('|'), searchText,
        universal ? 'يناسب حسب المواصفات ودليل المالك' : null, universal ? 'Fits by specification / owner manual' : null, t.phys.w, t.phys.d[0], t.phys.d[1], t.phys.d[2], t.phys.h, chance(0.01) ? 'ARCHIVED' : 'ACTIVE', created, created,
      ]);
      identifiers.push([`${id}-i0`, id, 'MPN', partNumber, normalizePartNumber(partNumber), brand]);
      oemRefs.forEach((r, i) => identifiers.push([`${id}-i${i + 1}`, id, 'OEM', r, normalizePartNumber(r), null]));
      fit.forEach((m, i) => {
        const yFrom = int(m.yearFrom, m.yearTo);
        const yTo = Math.min(m.yearTo, yFrom + int(0, 8));
        const engines = chance(0.2) ? [pick(m.engines)] : [];
        fitments.push([`${id}-f${i}`, id, m.id, yFrom, yTo, engines.join('|'), chance(0.7) ? 'CATALOG' : 'SELLER', created]);
      });
      const offerCount = pick([1, 1, 2, 2, 2, 3, 3, 4, 5]);
      const used = new Set<string>();
      for (let j = 0; j < offerCount; j++) {
        const m = pick(merchants);
        if (used.has(m.id)) continue;
        used.add(m.id);
        const loc = pick(locsByMerchant.get(m.id)!);
        const oid = `${id}-o${j}`;
        const condition = chance(0.85) ? 'NEW' : chance(0.66) ? 'USED' : 'REFURBISHED';
        const base = int(t.price[0], t.price[1]);
        const price = condition === 'NEW' ? base : Math.round(base * 0.55);
        const dmin = pick([0, 0, 0, 1, 1, 2, 3]);
        offers.push([oid, m.id, id, loc.id, `LT-${idx}-${j}`, condition, price, chance(0.2) ? Math.round(price * 1.15) : null, pick([0, 0, 3, 6, 12]), dmin, dmin + pick([1, 1, 2, 3]), chance(0.03) ? 'PAUSED' : 'ACTIVE', 'PUBLIC', created, created, new Date(now.getTime() - (chance(0.7) ? int(0, 6) : chance(0.66) ? int(8, 20) : int(22, 60)) * 86_400_000 - int(0, 86_399_999)).toISOString()]);
        inventory.push([oid, chance(0.15) ? 0 : int(1, 60), 0, created]);
      }
    }
    await insertRows(
      'Product',
      ['id', 'nameAr', 'nameEn', 'descriptionAr', 'descriptionEn', 'categoryId', 'brand', 'origin', 'partNumber', 'art', 'keywords', 'searchText', 'universalNoteAr', 'universalNoteEn', 'weightGrams', 'lengthCm', 'widthCm', 'heightCm', 'handling', 'status', 'createdAt', 'updatedAt'],
      ['text', 'text', 'text', 'text', 'text', 'text', 'text', '"PartOrigin"', 'text', 'text', 'text[]', 'text', 'text', 'text', 'int', 'int', 'int', 'int', '"Handling"', '"ProductStatus"', 'timestamp', 'timestamp'],
      products,
    );
    await insertRows('ProductIdentifier', ['id', 'productId', 'type', 'value', 'normalized', 'brand'], ['text', 'text', '"IdentifierType"', 'text', 'text', 'text'], identifiers);
    await insertRows('ProductFitment', ['id', 'productId', 'modelId', 'yearFrom', 'yearTo', 'engines', 'source', 'createdAt'], ['text', 'text', 'text', 'int', 'int', 'text[]', '"FitmentSource"', 'timestamp'], fitments);
    await insertRows(
      'Offer',
      ['id', 'merchantId', 'productId', 'locationId', 'sku', 'condition', 'priceHalalas', 'compareAtHalalas', 'warrantyMonths', 'dispatchDaysMin', 'dispatchDaysMax', 'status', 'visibility', 'createdAt', 'updatedAt', 'lastConfirmedAt'],
      ['text', 'text', 'text', 'text', 'text', '"Condition"', 'int', 'int', 'int', 'int', 'int', '"OfferStatus"', '"OfferVisibility"', 'timestamp', 'timestamp', 'timestamp'],
      offers,
    );
    await insertRows('InventoryLevel', ['offerId', 'onHand', 'reserved', 'updatedAt'], ['text', 'int', 'int', 'timestamp'], inventory);
    offersTotal += offers.length;
    fitTotal += fitments.length;
    if ((start / BATCH) % 10 === 0 || start + n >= PRODUCTS) console.log(`  ${(start + n).toLocaleString()} products, ${offersTotal.toLocaleString()} offers, ${fitTotal.toLocaleString()} fitment rows (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }

  console.log('deriving ProductListing through the application (backfill throughput)…');
  const t0 = Date.now();
  let last = 0;
  const r = await rebuildAllListings({
    batch: 1000,
    onBatch: (scanned) => {
      if (Date.now() - last > 10_000) {
        last = Date.now();
        console.log(`  … ${scanned.toLocaleString()} listings`);
      }
    },
  });
  const secs = (Date.now() - t0) / 1000;
  console.log(`  ${r.scanned.toLocaleString()} listings derived in ${secs.toFixed(1)}s (${Math.round(r.scanned / secs).toLocaleString()} products/s)`);
  await prisma.$executeRawUnsafe('ANALYZE');
  const counts = await prisma.$queryRaw<{ products: bigint; offers: bigint; fitments: bigint; listed: bigint }[]>`
    SELECT (SELECT count(*) FROM "Product") AS products, (SELECT count(*) FROM "Offer") AS offers,
           (SELECT count(*) FROM "ProductFitment") AS fitments, (SELECT count(*) FROM "ProductListing" WHERE listed) AS listed`;
  console.log('done:', Object.fromEntries(Object.entries(counts[0]).map(([k, v]) => [k, Number(v)])), `in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

