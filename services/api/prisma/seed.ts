/**
 * Sandbox/staging seed. Creates clearly-labelled TEST data only:
 * 6 approved merchants (9 pickup locations), 1 merchant awaiting approval, 30 products with fitment,
 * 60+ overlapping offers, Qitah ops/finance users and a demo customer.
 *
 * Usage: npm run db:seed            (only on an empty database)
 *        npm run db:seed -- --force (wipes ALL data first; refused in production)
 */
import { PrismaClient, type Handling } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashPassword } from '../src/auth/crypto.js';
import { GENERIC_MAINTENANCE_TEMPLATES } from '../src/lib/maintenance.js';
import { normalizePartNumber } from '../src/lib/text.js';
import { buildSearchText } from '../src/services/catalog.js';

type L10n = { ar: string; en: string };
type SeedData = {
  categories: { id: string; name: L10n; art: string }[];
  makes: { id: string; name: L10n; models: { id: string; name: L10n; yearFrom: number; yearTo: number; trims: string[]; engines: string[] }[] }[];
  products: {
    id: string; name: L10n; categoryId: string; brand: string; origin: 'oem' | 'aftermarket'; partNumber: string; oemReferences: string[];
    description: L10n; specs: unknown[]; universal?: { note: L10n }; fitment: { modelId: string; yearFrom: number; yearTo: number; engines?: string[]; source: 'catalog' | 'seller' }[];
    art: string; keywords: string[];
  }[];
  sellers: { id: string; name: L10n; city: string; joinedYear: number; responseHours: number; supportsWorkshopDelivery: boolean; specialty: L10n }[];
  offers: { id: string; productId: string; sellerId: string; price: number; compareAtPrice?: number; stock: number; condition: 'new' | 'used' | 'refurbished'; warrantyMonths: number; dispatchDays: [number, number]; note?: L10n }[];
};

const prisma = new PrismaClient();
const data = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'seed-data.json'), 'utf8')) as SeedData;

/** Physical attributes by part type (grams, cm). Needed for shipping groups and carrier rules. */
const PHYSICAL: Record<string, { w: number; d: [number, number, number]; h: Handling }> = {
  pads: { w: 2200, d: [20, 15, 8], h: 'STANDARD' },
  rotor: { w: 7500, d: [32, 32, 8], h: 'STANDARD' },
  oilFilter: { w: 400, d: [12, 10, 10], h: 'STANDARD' },
  airFilter: { w: 600, d: [35, 25, 6], h: 'STANDARD' },
  oil: { w: 4600, d: [28, 18, 12], h: 'STANDARD' },
  sparkPlug: { w: 300, d: [15, 10, 5], h: 'STANDARD' },
  belt: { w: 500, d: [25, 25, 4], h: 'STANDARD' },
  pump: { w: 3000, d: [25, 20, 18], h: 'STANDARD' },
  radiator: { w: 9000, d: [75, 50, 8], h: 'FRAGILE' },
  battery: { w: 19000, d: [28, 18, 20], h: 'HAZMAT' },
  alternator: { w: 6500, d: [25, 20, 20], h: 'STANDARD' },
  headlight: { w: 4000, d: [60, 35, 30], h: 'FRAGILE' },
  shock: { w: 4200, d: [60, 12, 12], h: 'STANDARD' },
  mirror: { w: 1800, d: [35, 25, 20], h: 'FRAGILE' },
  bumper: { w: 8000, d: [180, 50, 40], h: 'OVERSIZED' },
};

/** Four extra products (to reach 30) with deliberate overlap and an incompatible-vehicle case. */
const EXTRA_PRODUCTS: SeedData['products'] = [
  {
    id: 'p-patrol-cabin-filter', name: { ar: 'فلتر مكيف — باترول', en: 'Cabin air filter — Patrol' }, categoryId: 'filters', brand: 'Nissan Genuine', origin: 'oem',
    partNumber: '27277-1LA0A', oemReferences: ['27277-1LA0A'], description: { ar: 'فلتر مكيف أصلي لباترول.', en: 'Genuine cabin filter for Patrol.' }, specs: [],
    fitment: [{ modelId: 'patrol', yearFrom: 2016, yearTo: 2025, source: 'catalog' }], art: 'airFilter', keywords: ['cabin filter', 'فلتر مكيف', 'باترول'],
  },
  {
    id: 'p-elantra-pads-ceramic', name: { ar: 'فحمات فرامل سيراميك — إلنترا', en: 'Ceramic brake pads — Elantra' }, categoryId: 'brakes', brand: 'Brembo', origin: 'aftermarket',
    partNumber: 'P30098', oemReferences: ['58101-AAA00'], description: { ar: 'فحمات أمامية سيراميك قليلة الغبار.', en: 'Low-dust ceramic front pads.' }, specs: [],
    fitment: [{ modelId: 'elantra', yearFrom: 2021, yearTo: 2025, source: 'catalog' }], art: 'pads', keywords: ['brake pads', 'فحمات', 'إلنترا'],
  },
  {
    id: 'p-hilux-shock-rear', name: { ar: 'مساعد خلفي — هايلكس', en: 'Rear shock absorber — Hilux' }, categoryId: 'suspension', brand: 'KYB', origin: 'aftermarket',
    partNumber: 'KYB-349177', oemReferences: ['48531-0K390'], description: { ar: 'مساعد غازي خلفي لهايلكس.', en: 'Gas rear shock for Hilux.' }, specs: [],
    fitment: [{ modelId: 'hilux', yearFrom: 2016, yearTo: 2025, source: 'seller' }], art: 'shock', keywords: ['shock', 'مساعد', 'هايلكس'],
  },
  {
    id: 'p-coolant-1gal', name: { ar: 'سائل تبريد طويل الأمد — جالون', en: 'Long-life coolant — 1 gallon' }, categoryId: 'oils', brand: 'Toyota Genuine', origin: 'oem',
    partNumber: '00272-1LLAC', oemReferences: ['00272-1LLAC'], description: { ar: 'سائل تبريد وردي جاهز للاستخدام.', en: 'Pre-mixed pink super long-life coolant.' }, specs: [],
    universal: { note: { ar: 'يناسب السيارات التي تتطلب سائل تبريد SLLC الوردي حسب دليل المالك', en: 'For vehicles specifying pink SLLC coolant per owner manual' } },
    fitment: [], art: 'oil', keywords: ['coolant', 'ماء رديتر', 'سائل تبريد'],
  },
];

const EXTRA_OFFERS: SeedData['offers'] = [
  { id: 'o-101', productId: 'p-patrol-cabin-filter', sellerId: 's-riyadh-center', price: 145, stock: 20, condition: 'new', warrantyMonths: 0, dispatchDays: [0, 1] },
  { id: 'o-102', productId: 'p-patrol-cabin-filter', sellerId: 's-eastern', price: 129, stock: 8, condition: 'new', warrantyMonths: 0, dispatchDays: [1, 2] },
  { id: 'o-103', productId: 'p-elantra-pads-ceramic', sellerId: 's-brake-house', price: 219, stock: 15, condition: 'new', warrantyMonths: 12, dispatchDays: [0, 1] },
  { id: 'o-104', productId: 'p-elantra-pads-ceramic', sellerId: 's-quickfix', price: 205, stock: 3, condition: 'new', warrantyMonths: 6, dispatchDays: [1, 3] },
  { id: 'o-105', productId: 'p-hilux-shock-rear', sellerId: 's-salvage', price: 160, stock: 2, condition: 'used', warrantyMonths: 1, dispatchDays: [1, 2] },
  { id: 'o-106', productId: 'p-hilux-shock-rear', sellerId: 's-eastern', price: 310, stock: 10, condition: 'new', warrantyMonths: 12, dispatchDays: [0, 2] },
  { id: 'o-107', productId: 'p-coolant-1gal', sellerId: 's-riyadh-center', price: 49, stock: 60, condition: 'new', warrantyMonths: 0, dispatchDays: [0, 1] },
  { id: 'o-108', productId: 'p-coolant-1gal', sellerId: 's-elite-oils', price: 45, stock: 40, condition: 'new', warrantyMonths: 0, dispatchDays: [0, 1] },
];

const LOCATIONS: Record<string, { id: string; name: string; city: string; district: string; street: string }[]> = {
  's-riyadh-center': [
    { id: 'loc-rc-olaya', name: 'فرع العليا', city: 'riyadh', district: 'العليا', street: 'طريق الملك فهد' },
    { id: 'loc-rc-sulay', name: 'مستودع السلي', city: 'riyadh', district: 'السلي', street: 'شارع الصناعية الثانية' },
  ],
  's-eastern': [
    { id: 'loc-ea-dammam', name: 'فرع الدمام', city: 'dammam', district: 'الصناعية الأولى', street: 'شارع 22' },
    { id: 'loc-ea-khobar', name: 'فرع الخبر', city: 'khobar', district: 'الثقبة', street: 'شارع الأمير فيصل بن فهد' },
  ],
  's-brake-house': [
    { id: 'loc-bh-jeddah', name: 'فرع جدة', city: 'jeddah', district: 'الصناعية', street: 'شارع الميناء' },
    { id: 'loc-bh-makkah', name: 'فرع مكة', city: 'makkah', district: 'العزيزية', street: 'الطريق الدائري الثالث' },
  ],
  's-salvage': [{ id: 'loc-sv-riyadh', name: 'ساحة التشليح', city: 'riyadh', district: 'حي المصانع', street: 'طريق الخرج' }],
  's-elite-oils': [{ id: 'loc-eo-khobar', name: 'مستودع الخبر', city: 'khobar', district: 'العقربية', street: 'شارع الملك خالد' }],
  's-quickfix': [{ id: 'loc-qf-madinah', name: 'فرع المدينة', city: 'madinah', district: 'العزيزية', street: 'طريق الملك عبدالله' }],
};

const PASSWORD = process.env.SEED_PASSWORD ?? 'Qitah-Sandbox-2026!';

async function wipe() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  const force = process.argv.includes('--force');
  if (force) await wipe();
  else if ((await prisma.merchant.count()) > 0) {
    console.log('Database already has data; use --force to wipe and reseed.');
    return;
  }
  const passwordHash = await hashPassword(PASSWORD);

  for (const [i, c] of data.categories.entries()) await prisma.category.create({ data: { id: c.id, nameAr: c.name.ar, nameEn: c.name.en, art: c.art, sort: i } });
  for (const m of data.makes) {
    await prisma.vehicleMake.create({
      data: {
        id: m.id, nameAr: m.name.ar, nameEn: m.name.en,
        models: { create: m.models.map((x) => ({ id: x.id, nameAr: x.name.ar, nameEn: x.name.en, yearFrom: x.yearFrom, yearTo: x.yearTo, trims: x.trims, engines: x.engines })) },
      },
    });
  }

  // Qitah staff
  const staff = [
    { email: 'ops.admin@qitah.test', name: 'مدير العمليات (تجريبي)', roles: ['OPS_ADMIN'] as const },
    { email: 'ops.agent@qitah.test', name: 'موظف العمليات (تجريبي)', roles: ['OPS_AGENT'] as const },
    { email: 'finance@qitah.test', name: 'المالية (تجريبي)', roles: ['FINANCE'] as const },
  ];
  for (const s of staff) {
    await prisma.user.create({ data: { email: s.email, name: s.name, passwordHash, platformRoles: { create: s.roles.map((role) => ({ role })) } } });
  }

  // Merchants (all fictional, sandbox CR numbers)
  for (const [i, s] of data.sellers.entries()) {
    const slug = s.id.replace(/^s-/, '');
    const owner = await prisma.user.create({ data: { email: `owner@${slug}.qitah.test`, name: `مالك ${s.name.ar} (تجريبي)`, passwordHash } });
    const staffUser = await prisma.user.create({ data: { email: `staff@${slug}.qitah.test`, name: `موظف ${s.name.ar} (تجريبي)`, passwordHash } });
    await prisma.merchant.create({
      data: {
        id: s.id,
        legalName: `${s.name.en} Trading Est. (SANDBOX)`,
        displayNameAr: s.name.ar,
        displayNameEn: s.name.en,
        crNumber: String(1010000000 + i * 1111),
        vatNumber: `3${String(100000000000 + i).padStart(13, '0')}3`,
        city: s.city,
        specialtyAr: s.specialty.ar,
        specialtyEn: s.specialty.en,
        contactEmail: `owner@${slug}.qitah.test`,
        contactPhone: `+96650000${String(1000 + i)}`,
        status: 'APPROVED',
        approvedAt: new Date(),
        commissionBps: s.id === 's-salvage' ? 1200 : 1000,
        supportsWorkshopDelivery: s.supportsWorkshopDelivery,
        slaAcceptMinutes: Math.max(60, s.responseHours * 60),
        createdAt: new Date(Date.UTC(s.joinedYear, 0, 15)),
        members: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: staffUser.id, role: 'STAFF' }] },
        verifications: { create: { status: 'APPROVED', documents: [{ type: 'CR', reference: 'SANDBOX' }], reviewedAt: new Date(), reviewNote: 'Sandbox seed' } },
        locations: { create: LOCATIONS[s.id].map((l, k) => ({ ...l, contactPhone: `+9665000${String(20000 + i * 10 + k)}` })) },
      },
    });
  }

  // A merchant waiting for approval (to demonstrate onboarding review)
  const applicant = await prisma.user.create({ data: { email: 'owner@new-applicant.qitah.test', name: 'متقدم جديد (تجريبي)', passwordHash } });
  await prisma.merchant.create({
    data: {
      legalName: 'Najd Auto Spares Est. (SANDBOX)', displayNameAr: 'نجد لقطع الغيار', displayNameEn: 'Najd Auto Spares', crNumber: '1010999999', city: 'riyadh',
      contactEmail: 'owner@new-applicant.qitah.test', contactPhone: '+966500009999', status: 'UNDER_REVIEW', specialtyAr: 'قطع كورية', specialtyEn: 'Korean parts',
      members: { create: { userId: applicant.id, role: 'OWNER' } },
      verifications: { create: { status: 'PENDING', documents: [{ type: 'CR', reference: '1010999999' }] } },
      locations: { create: { name: 'الفرع الرئيسي', city: 'riyadh', district: 'الروضة', street: 'شارع خالد بن الوليد', contactPhone: '+966500009998' } },
    },
  });

  // Products
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  for (const p of [...data.products, ...EXTRA_PRODUCTS]) {
    const phys = PHYSICAL[p.art] ?? { w: 1000, d: [20, 20, 20] as [number, number, number], h: 'STANDARD' as Handling };
    const cat = categories.get(p.categoryId)!;
    await prisma.product.create({
      data: {
        id: p.id, nameAr: p.name.ar, nameEn: p.name.en, descriptionAr: p.description.ar, descriptionEn: p.description.en, categoryId: p.categoryId,
        brand: p.brand, origin: p.origin === 'oem' ? 'OEM' : 'AFTERMARKET', partNumber: p.partNumber, art: p.art, keywords: p.keywords,
        specs: p.specs as object[], universalNoteAr: p.universal?.note.ar, universalNoteEn: p.universal?.note.en,
        weightGrams: phys.w, lengthCm: phys.d[0], widthCm: phys.d[1], heightCm: phys.d[2], handling: phys.h,
        searchText: buildSearchText({ nameAr: p.name.ar, nameEn: p.name.en, brand: p.brand, keywords: p.keywords, partNumber: p.partNumber, identifiers: p.oemReferences, categoryNames: [cat.name.ar, cat.name.en], categoryId: p.categoryId, art: p.art }),
        identifiers: {
          create: [
            { type: 'MPN', value: p.partNumber, normalized: normalizePartNumber(p.partNumber), brand: p.brand },
            ...[...new Set(p.oemReferences)].filter((r) => normalizePartNumber(r) !== normalizePartNumber(p.partNumber)).map((r) => ({ type: 'OEM' as const, value: r, normalized: normalizePartNumber(r) })),
            ...(p.oemReferences.some((r) => normalizePartNumber(r) === normalizePartNumber(p.partNumber)) ? [{ type: 'OEM' as const, value: p.partNumber, normalized: normalizePartNumber(p.partNumber) }] : []),
          ],
        },
        fitments: { create: p.fitment.map((f) => ({ modelId: f.modelId, yearFrom: f.yearFrom, yearTo: f.yearTo, engines: f.engines ?? [], source: f.source === 'catalog' ? 'CATALOG' : 'SELLER' })) },
      },
    });
  }

  // Offers + inventory. Multi-location merchants alternate locations so origin-aware grouping is exercised.
  for (const [i, o] of [...data.offers, ...EXTRA_OFFERS].entries()) {
    const locs = LOCATIONS[o.sellerId];
    const loc = locs[i % locs.length];
    await prisma.offer.create({
      data: {
        id: o.id, merchantId: o.sellerId, productId: o.productId, locationId: loc.id, sku: `${o.sellerId.slice(2, 6).toUpperCase()}-${o.id}`,
        condition: o.condition.toUpperCase() as 'NEW', priceHalalas: Math.round(o.price * 100),
        compareAtHalalas: o.compareAtPrice ? Math.round(o.compareAtPrice * 100) : null, warrantyMonths: o.warrantyMonths,
        dispatchDaysMin: o.dispatchDays[0], dispatchDaysMax: o.dispatchDays[1], noteAr: o.note?.ar, noteEn: o.note?.en,
        inventory: { create: { onHand: o.stock } },
        adjustments: o.stock ? { create: { delta: o.stock, onHandAfter: o.stock, reason: 'INITIAL', note: 'seed' } } : undefined,
      },
    });
  }

  // Generic maintenance guidance (labelled "check your owner's manual"; no manufacturer intervals invented)
  for (const t of GENERIC_MAINTENANCE_TEMPLATES) {
    await prisma.maintenanceTemplate.create({
      data: {
        id: t.id, serviceCode: t.serviceCode, makeId: t.makeId ?? null, modelId: t.modelId ?? null, nameAr: t.nameAr, nameEn: t.nameEn, noteAr: t.noteAr, noteEn: t.noteEn,
        intervalKm: t.intervalKm ?? null, intervalMonths: t.intervalMonths ?? null, variants: t.variants, components: t.components as object[],
        categoryIds: [...new Set(t.components.flatMap((c) => c.categoryIds))], keywords: [...new Set(t.components.flatMap((c) => c.keywords))], sort: t.sort,
      },
    });
  }

  // Demo customer with a garage vehicle (odometer + one service record, so maintenance has data) and two addresses
  const monthsAgo = (n: number) => new Date(Date.now() - n * 30 * 86_400_000);
  await prisma.user.create({
    data: {
      phone: '+966500000001', name: 'عميل تجريبي',
      vehicles: {
        create: [
          {
            modelId: 'camry', year: 2022, trim: 'GLE', engine: '2.5L I4', odometerKm: 48_500, odometerUpdatedAt: new Date(),
            serviceRecords: { create: [{ serviceCode: 'OIL_CHANGE', variant: 'SYNTHETIC', doneAtKm: 39_800, doneAt: monthsAgo(5) }] },
          },
          { modelId: 'patrol', year: 2020, trim: 'LE', engine: '4.0L V6' },
        ],
      },
      addresses: {
        create: [
          { kind: 'HOME', label: 'المنزل', city: 'riyadh', district: 'الملقا', street: 'شارع أنس بن مالك', contactName: 'عميل تجريبي', phone: '+966500000001' },
          { kind: 'WORKSHOP', label: 'الورشة', city: 'jeddah', district: 'الصناعية', street: 'شارع الصناعة', contactName: 'عميل تجريبي', phone: '+966500000001', workshopName: 'ورشة النخبة' },
        ],
      },
    },
  });

  const counts = {
    merchants: await prisma.merchant.count(),
    locations: await prisma.pickupLocation.count(),
    products: await prisma.product.count(),
    offers: await prisma.offer.count(),
    users: await prisma.user.count(),
  };
  console.log('Seeded sandbox data:', counts, `\nAll seeded staff/merchant users share the password from SEED_PASSWORD (default ${PASSWORD}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
