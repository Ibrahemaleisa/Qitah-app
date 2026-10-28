import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { normalizeText } from '../src/lib/text.js';
import {
  analyzeQuery,
  CONCEPTS,
  foldText,
  getConcept,
  isCategoryConcept,
  productConcepts,
  resolveVehicle,
  stemToken,
  stripVehicleFromQuery,
  suggestCorrection,
  type LexMake,
} from '../src/search/lexicon.js';

/** Pure unit tests for the shared search lexicon (no database). */

type L10n = { ar: string; en: string };
type Seed = {
  categories: { id: string; name: L10n }[];
  makes: { id: string; name: L10n; models: { id: string; name: L10n; yearFrom: number; yearTo: number }[] }[];
  products: { id: string; name: L10n; categoryId: string; art: string; keywords: string[] }[];
};
const seed = JSON.parse(readFileSync(new URL('../prisma/seed-data.json', import.meta.url), 'utf8')) as Seed;
const makes: LexMake[] = seed.makes;
const groups = (q: string) => analyzeQuery(q, makes).conceptGroups.map((g) => g.join('|'));

/** The 35 colloquial queries from the committee review (02-product-ux.md, issue 1) plus the spec list. */
const COLLOQUIAL: [string, string][] = [
  ['كفرات', 'tires'],
  ['اطارات', 'tires'],
  ['كفر', 'tires'],
  ['قربة', 'radiator'],
  ['رديتر', 'radiator'],
  ['راديتر', 'radiator'],
  ['بوجيهات', 'sparkPlugs'],
  ['بواجي', 'sparkPlugs'],
  ['بوجي', 'sparkPlugs'],
  ['هوبات', 'brakeRotors'],
  ['ديسكات', 'brakeRotors'],
  ['طنابير', 'brakeRotors'],
  ['كلتش', 'clutch'],
  ['دبرياج', 'clutch'],
  ['قير', 'transmission'],
  ['جير', 'transmission'],
  ['كمبروسر', 'acCompressor'],
  ['كمبروسر مكيف', 'acCompressor'],
  ['سلف', 'starter'],
  ['مارش', 'starter'],
  ['فحمات', 'brakePads'],
  ['فحمة', 'brakePads'],
  ['بريك', 'brakePads'],
  ['مساعدات', 'shock'],
  ['مساعد', 'shock'],
  ['دينمو', 'alternator'],
  ['دينامو', 'alternator'],
  ['بطارية', 'battery'],
  ['بطاريه', 'battery'],
  ['سير', 'belt'],
  ['سيور', 'belt'],
  ['فلتر هوا', 'airFilter'],
  ['فلتر مكيف', 'cabinFilter'],
  ['زيت', 'engineOil'],
  ['زيوت', 'engineOil'],
  ['لمبة', 'lighting'],
  ['لمبات', 'lighting'],
  ['اضاءة', 'lighting'],
  ['شمعة', 'lighting'],
  ['مراية', 'mirror'],
  ['مرايه', 'mirror'],
  ['صدام', 'bumper'],
  ['دعامية', 'bumper'],
  ['ماء رديتر', 'coolant'],
  ['سائل تبريد', 'coolant'],
  ['فلتر زيت', 'oilFilter'],
];

test('lexicon: every colloquial query maps to its canonical concept', () => {
  assert.ok(COLLOQUIAL.length >= 35);
  for (const [q, concept] of COLLOQUIAL) assert.deepEqual(groups(q), [concept], q);
});

test('lexicon: variants — definite article, plurals, tashkeel, English, mixed case', () => {
  const cases: [string, string][] = [
    ['الفحمات', 'brakePads'],
    ['الكفرات', 'tires'],
    ['الاطارات', 'tires'],
    ['القربة', 'radiator'],
    ['البواجي', 'sparkPlugs'],
    ['المساعدين', 'shock'],
    ['البطاريات', 'battery'],
    ['الديسكات', 'brakeRotors'],
    ['فَحمات', 'brakePads'],
    ['Brake Pads', 'brakePads'],
    ['spark plugs', 'sparkPlugs'],
    ['TIRES', 'tires'],
    ['radiator', 'radiator'],
    ['starter motor', 'starter'],
    ['A/C compressor', 'acCompressor'],
    ['clutch', 'clutch'],
    ['shock absorbers', 'shock'],
    ['bumper', 'bumper'],
    ['coolant', 'coolant'],
  ];
  for (const [q, concept] of cases) assert.deepEqual(groups(q), [concept], q);
  // Exact forms beat stems: singular "شمعة" is a headlight, plural "شمعات" is ambiguous (shocks / plugs).
  assert.deepEqual(groups('شمعات'), ['shock|sparkPlugs']);
  // Longest phrase wins: an oil filter is not engine oil, coolant is not a radiator.
  assert.deepEqual(groups('فلتر زيت'), ['oilFilter']);
  assert.deepEqual(groups('ماء رديتر'), ['coolant']);
});

test('lexicon: light stemming strips ال / ات / ين / ة but keeps three letters', () => {
  assert.equal(stemToken('الفحمات'), 'فحم');
  assert.equal(stemToken('مساعدين'), 'مساعد');
  assert.equal(stemToken(foldText('بطارية')), 'بطاري');
  assert.equal(stemToken('سير'), 'سير');
  assert.equal(stemToken('ات'), 'ات');
  assert.equal(stemToken('pads'), 'pad');
  assert.equal(stemToken('glass'), 'glass');
});

test('lexicon: foldText is identical to lib/text normalizeText', () => {
  for (const s of ['فحمات فرامل أمامية — كامري', 'زيت ⁦5W-30⁩', 'إطارات', 'مرآة', 'بطاريةٌ', '٢٠٢٢', 'Camry']) assert.equal(foldText(s), normalizeText(s), s);
});

test('parser: "فلتر زيت كامري 2022" → concept oilFilter + Camry + 2022', () => {
  const a = analyzeQuery('فلتر زيت كامري 2022', makes);
  assert.deepEqual(a.conceptGroups, [['oilFilter']]);
  assert.equal(a.vehicle?.modelId, 'camry');
  assert.equal(a.vehicle?.makeId, 'toyota');
  assert.equal(a.year, 2022);
  assert.deepEqual(a.freeTokens, []);
  assert.deepEqual(resolveVehicle(a, undefined, makes), { source: 'query', makeId: 'toyota', modelId: 'camry', year: 2022, scope: 'vehicle' });
  assert.equal(stripVehicleFromQuery(a), 'فلتر زيت');
});

test('parser: vehicles in Arabic and English, with prefixes, makes and Arabic digits', () => {
  const v = (q: string) => {
    const a = analyzeQuery(q, makes);
    return [a.vehicle?.makeId, a.vehicle?.modelId ?? null, a.year];
  };
  assert.deepEqual(v('زيت كامري'), ['toyota', 'camry', null]);
  assert.deepEqual(v('brake pads camry 2021'), ['toyota', 'camry', 2021]);
  assert.deepEqual(v('فحمات لكامري ٢٠٢٢'), ['toyota', 'camry', 2022]);
  assert.deepEqual(v('تويوتا كامري فحمات'), ['toyota', 'camry', null]);
  assert.deepEqual(v('هوب لاند كروزر 2019'), ['toyota', 'land-cruiser', 2019]);
  assert.deepEqual(v('ابي قربة حق باترول'), ['nissan', 'patrol', null]);
  assert.deepEqual(v('مساعد اف 150'), ['ford', 'f150', null]);
  assert.deepEqual(v('بطارية جمس'), ['gmc', null, null]);
  assert.deepEqual(v('فحمات'), [undefined, null, null]);
  // Stop words and the remaining free words
  const a = analyzeQuery('ابي فحمات سيراميك حق النترا', makes);
  assert.deepEqual(a.conceptGroups, [['brakePads']]);
  assert.deepEqual(a.freeTokens, ['سيراميك']);
  assert.equal(a.vehicle?.modelId, 'elantra');
});

test('parser: part numbers are detected and never mistaken for years or concepts', () => {
  assert.equal(analyzeQuery('04465-X3301', makes).partNumber, '04465x3301');
  assert.equal(analyzeQuery('KYB-349177', makes).partNumber, 'kyb349177');
  const mixed = analyzeQuery('فحمات 04465-X3301', makes);
  assert.deepEqual(mixed.partNumbers, ['04465x3301']);
  assert.deepEqual(mixed.conceptGroups, [['brakePads']]);
  assert.equal(analyzeQuery('2022', makes).partNumber, null);
  assert.equal(analyzeQuery('زيت 5w-30', makes).partNumber, null);
});

test('vehicle resolution never claims more than the data supports', () => {
  const garage = { modelId: 'camry', year: 2022, engine: '2.5L I4' };
  // Typed model = selected model: keep the selected year and engine.
  assert.deepEqual(resolveVehicle(analyzeQuery('فحمات كامري', makes), garage, makes), { source: 'query', makeId: 'toyota', modelId: 'camry', year: 2022, engine: '2.5L I4', scope: 'vehicle' });
  // Different year typed: the engine is no longer known.
  assert.equal(resolveVehicle(analyzeQuery('فحمات كامري 2019', makes), garage, makes)?.engine, undefined);
  // A different model typed: no year → model scope only.
  assert.deepEqual(resolveVehicle(analyzeQuery('فحمات باترول', makes), garage, makes), { source: 'query', makeId: 'nissan', modelId: 'patrol', scope: 'model' });
  // Nothing typed: the selected vehicle.
  assert.equal(resolveVehicle(analyzeQuery('فحمات', makes), garage, makes)?.source, 'garage');
  // Out-of-range year is flagged.
  assert.equal(resolveVehicle(analyzeQuery('فحمات كامري 2010', makes), undefined, makes)?.yearOutOfRange, true);
  // Make only.
  assert.equal(resolveVehicle(analyzeQuery('زيت نيسان', makes), undefined, makes)?.scope, 'make');
});

test('did-you-mean suggests a known part term one edit away', () => {
  assert.equal(suggestCorrection(analyzeQuery('فحمت', makes)), 'فحمات');
  const fixed = suggestCorrection(analyzeQuery('رديتير باترول', makes));
  assert.ok(fixed);
  assert.deepEqual(analyzeQuery(fixed, makes).conceptGroups, [['radiator']]);
  assert.equal(analyzeQuery(fixed, makes).vehicle?.modelId, 'patrol');
  assert.equal(suggestCorrection(analyzeQuery('فحمات', makes)), null);
});

test('concepts map onto the real seed: every carried concept has products, every product a concept in its category', () => {
  const categoryIds = new Set(seed.categories.map((c) => c.id));
  const covered = new Set<string>();
  for (const p of seed.products) {
    const ids = productConcepts({ nameAr: p.name.ar, nameEn: p.name.en, categoryId: p.categoryId, art: p.art, keywords: p.keywords });
    const specific = ids.filter((id) => !isCategoryConcept(id));
    assert.ok(specific.length >= 1, `${p.id} has no specific concept: ${ids}`);
    ids.forEach((id) => covered.add(id));
  }
  for (const c of CONCEPTS) {
    if (c.categoryId) assert.ok(categoryIds.has(c.categoryId), `${c.id} → unknown category ${c.categoryId}`);
    if (c.carried) assert.ok(covered.has(c.id), `carried concept ${c.id} matches no seed product`);
    else assert.ok(!covered.has(c.id), `${c.id} is marked not carried but matches seed products`);
  }
  // Oil filters are not engine oil even though their keywords say "زيت".
  const oilFilter = seed.products.find((p) => p.id === 'p-toyota-oil-filter')!;
  assert.ok(!productConcepts({ nameAr: oilFilter.name.ar, nameEn: oilFilter.name.en, categoryId: oilFilter.categoryId, art: oilFilter.art, keywords: oilFilter.keywords }).includes('engineOil'));
});

test('the app keeps a byte-identical copy of the lexicon', { skip: !existsSync(new URL('../../../src/lib/search/lexicon.ts', import.meta.url)) && 'app source not present' }, () => {
  const server = readFileSync(new URL('../src/search/lexicon.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../../src/lib/search/lexicon.ts', import.meta.url), 'utf8');
  assert.equal(app, server, 'src/lib/search/lexicon.ts and services/api/src/search/lexicon.ts differ — copy one over the other');
});
