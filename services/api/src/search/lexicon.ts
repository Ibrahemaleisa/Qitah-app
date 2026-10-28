/**
 * Qitah search lexicon — how Saudi customers actually ask for parts.
 *
 * SHARED FILE. Byte-identical copies live at:
 *   - services/api/src/search/lexicon.ts   (server: searchText indexing + /v1/catalog/search)
 *   - src/lib/search/lexicon.ts            (app: demo-mode search + query chips)
 * Tests in both packages fail if the copies drift. Edit one, then copy it over the other.
 * It must stay dependency-free (no imports) so the same text compiles in both packages.
 *
 * What it does:
 *   1. CONCEPTS: colloquial / plural / English surface forms → one canonical part concept, mapped to the
 *      real seed categories and product art kinds. Concepts the catalog does not carry yet (tires, clutch…)
 *      are still recognised so the UI can say "we don't list X yet — request it" instead of a dead end.
 *   2. Light Arabic normalisation + stemming (ال، ات، ين، ون، ة) used only where it is safe.
 *   3. analyzeQuery(): splits a query into part concepts, a vehicle (make/model from reference data),
 *      a 4-digit year, part numbers and the remaining free words.
 *   4. resolveVehicle(): combines the vehicle typed in the query with the customer's selected vehicle,
 *      never claiming more precision (year, engine) than either source actually provides.
 */

export type LexText = { ar: string; en: string };

export type Concept = {
  id: string;
  label: LexText;
  /** Seed category the concept belongs to (used for "browse category" suggestions). */
  categoryId?: string;
  /** False when Qitah does not list this kind of part yet. */
  carried: boolean;
  /** Product art kinds that identify this concept when a product's name mentions no concept at all. */
  arts?: string[];
  /** Category-level concept: every product in these categories matches. */
  categories?: string[];
  /** Surface forms (colloquial, singular, plural, English). Multi-word phrases allowed. */
  terms: string[];
};

export const CONCEPTS: Concept[] = [
  // ── brakes
  {
    id: 'brakePads',
    label: { ar: 'فحمات فرامل', en: 'Brake pads' },
    categoryId: 'brakes',
    carried: true,
    arts: ['pads'],
    terms: ['فحمات', 'فحمة', 'فحمات فرامل', 'فحمات بريك', 'فحمات الفرامل', 'تيل', 'تيل فرامل', 'بريك', 'بريكات', 'brake pads', 'brake pad', 'pads', 'pad'],
  },
  {
    id: 'brakeRotors',
    label: { ar: 'هوبات (ديسكات) فرامل', en: 'Brake rotors' },
    categoryId: 'brakes',
    carried: true,
    arts: ['rotor'],
    terms: ['هوب', 'هوبات', 'هوب فرامل', 'ديسك', 'ديسكات', 'ديسك فرامل', 'طنبور', 'طنابير', 'قرص', 'اقراص', 'قرص فرامل', 'اقراص فرامل', 'rotor', 'rotors', 'brake rotor', 'brake rotors', 'disc', 'discs', 'brake disc', 'brake discs'],
  },
  { id: 'brakes', label: { ar: 'الفرامل', en: 'Brakes' }, categoryId: 'brakes', carried: true, categories: ['brakes'], terms: ['فرامل', 'brake', 'brakes'] },

  // ── filters
  {
    id: 'oilFilter',
    label: { ar: 'فلتر زيت', en: 'Oil filter' },
    categoryId: 'filters',
    carried: true,
    arts: ['oilFilter'],
    terms: ['فلتر زيت', 'فلاتر زيت', 'فلتر الزيت', 'فلتر زيوت', 'oil filter', 'oil filters'],
  },
  {
    id: 'airFilter',
    label: { ar: 'فلتر هواء', en: 'Engine air filter' },
    categoryId: 'filters',
    carried: true,
    arts: ['airFilter'],
    terms: ['فلتر هوا', 'فلتر هواء', 'فلتر الهوا', 'فلتر الهواء', 'فلاتر هواء', 'فلتر مكينه', 'فلتر هواء المحرك', 'air filter', 'air filters', 'engine air filter'],
  },
  {
    id: 'cabinFilter',
    label: { ar: 'فلتر مكيف', en: 'Cabin (A/C) filter' },
    categoryId: 'filters',
    carried: true,
    terms: ['فلتر مكيف', 'فلتر المكيف', 'فلاتر مكيف', 'فلتر تكييف', 'فلتر كبين', 'cabin filter', 'cabin air filter', 'ac filter', 'a/c filter', 'pollen filter'],
  },
  { id: 'filters', label: { ar: 'الفلاتر', en: 'Filters' }, categoryId: 'filters', carried: true, categories: ['filters'], terms: ['فلتر', 'فلاتر', 'filter', 'filters'] },

  // ── oils & fluids
  {
    id: 'engineOil',
    label: { ar: 'زيت محرك', en: 'Engine oil' },
    categoryId: 'oils',
    carried: true,
    terms: ['زيت', 'زيوت', 'زيت محرك', 'زيت مكينه', 'زيوت محرك', 'زيت المكينه', 'زيت المحرك', 'engine oil', 'motor oil', 'oil', 'oils'],
  },
  {
    id: 'coolant',
    label: { ar: 'سائل تبريد (ماء رديتر)', en: 'Coolant' },
    categoryId: 'cooling',
    carried: true,
    terms: ['سائل تبريد', 'ماء رديتر', 'ماء راديتر', 'ماي رديتر', 'مويه رديتر', 'موية رديتر', 'ماء الرديتر', 'كولنت', 'coolant', 'antifreeze', 'anti freeze'],
  },

  // ── engine
  {
    id: 'sparkPlugs',
    label: { ar: 'بواجي', en: 'Spark plugs' },
    categoryId: 'engine',
    carried: true,
    arts: ['sparkPlug'],
    terms: ['بواجي', 'بوجي', 'بوجيه', 'بوجيهات', 'بواجيه', 'بلك', 'بلكات', 'شمعات', 'شمعات احتراق', 'spark plug', 'spark plugs', 'plug', 'plugs'],
  },
  {
    id: 'belt',
    label: { ar: 'سير', en: 'Belt' },
    categoryId: 'engine',
    carried: true,
    arts: ['belt'],
    terms: ['سير', 'سيور', 'سير مكينه', 'سير محرك', 'سير المكينه', 'سير دينمو', 'سير مروحه', 'belt', 'belts', 'serpentine belt', 'drive belt', 'timing belt'],
  },
  {
    id: 'transmission',
    label: { ar: 'قير (ناقل حركة)', en: 'Transmission' },
    carried: false,
    terms: ['قير', 'جير', 'قيربوكس', 'جيربوكس', 'ناقل حركه', 'transmission', 'gearbox'],
  },
  {
    id: 'clutch',
    label: { ar: 'كلتش', en: 'Clutch' },
    carried: false,
    terms: ['كلتش', 'كلاتش', 'دبرياج', 'ديبرياج', 'صحن كلتش', 'clutch', 'clutch kit'],
  },

  // ── electrical
  {
    id: 'battery',
    label: { ar: 'بطارية', en: 'Battery' },
    categoryId: 'electrical',
    carried: true,
    arts: ['battery'],
    terms: ['بطاريه', 'بطاريات', 'بطاريه سياره', 'battery', 'batteries'],
  },
  {
    id: 'alternator',
    label: { ar: 'دينمو', en: 'Alternator' },
    categoryId: 'electrical',
    carried: true,
    arts: ['alternator'],
    terms: ['دينمو', 'دينامو', 'دينموه', 'دينمه', 'alternator', 'dynamo'],
  },
  {
    id: 'starter',
    label: { ar: 'سلف (مارش)', en: 'Starter motor' },
    categoryId: 'electrical',
    carried: false,
    terms: ['سلف', 'سلفات', 'مارش', 'مارشات', 'سلف مكينه', 'starter', 'starter motor', 'starters'],
  },

  // ── A/C & cooling
  {
    id: 'acCompressor',
    label: { ar: 'كمبروسر مكيف', en: 'A/C compressor' },
    carried: false,
    terms: ['كمبروسر', 'كومبروسر', 'كمبرسور', 'كمبريسر', 'كمبروسور', 'كمبروسر مكيف', 'كمبروسر المكيف', 'ضاغط مكيف', 'compressor', 'ac compressor', 'a/c compressor'],
  },
  {
    id: 'radiator',
    label: { ar: 'رديتر (قربة)', en: 'Radiator' },
    categoryId: 'cooling',
    carried: true,
    arts: ['radiator'],
    terms: ['قربه', 'قرب', 'قربه ماء', 'رديتر', 'راديتر', 'ردياتير', 'رادياتير', 'ردياتر', 'radiator', 'radiators'],
  },
  {
    id: 'waterPump',
    label: { ar: 'طرمبة ماء', en: 'Water pump' },
    categoryId: 'cooling',
    carried: true,
    arts: ['pump'],
    terms: ['طرمبه ماء', 'طرمبه مويه', 'طرمبه الماء', 'مضخه ماء', 'water pump', 'coolant pump'],
  },
  { id: 'cooling', label: { ar: 'التبريد', en: 'Cooling' }, categoryId: 'cooling', carried: true, categories: ['cooling'], terms: ['تبريد', 'cooling'] },

  // ── suspension
  {
    id: 'shock',
    label: { ar: 'مساعدات', en: 'Shock absorbers' },
    categoryId: 'suspension',
    carried: true,
    arts: ['shock'],
    terms: ['مساعد', 'مساعدات', 'مساعدين', 'شمعات', 'ممتص صدمات', 'shock', 'shocks', 'shock absorber', 'shock absorbers', 'absorber', 'strut', 'struts'],
  },
  { id: 'suspension', label: { ar: 'التعليق (العفشة)', en: 'Suspension' }, categoryId: 'suspension', carried: true, categories: ['suspension'], terms: ['تعليق', 'عفشه', 'suspension'] },

  // ── lighting
  {
    id: 'lighting',
    label: { ar: 'إضاءة (شمعات ولمبات)', en: 'Lights & bulbs' },
    categoryId: 'lighting',
    carried: true,
    arts: ['headlight'],
    categories: ['lighting'],
    terms: ['لمبه', 'لمبات', 'اضاءه', 'اضواء', 'شمعه', 'شمعه اماميه', 'اسطب', 'سطب', 'كشاف', 'كشافات', 'headlight', 'headlights', 'headlamp', 'headlamps', 'bulb', 'bulbs', 'light', 'lights', 'lighting'],
  },

  // ── body
  {
    id: 'mirror',
    label: { ar: 'مراية', en: 'Mirror' },
    categoryId: 'body',
    carried: true,
    arts: ['mirror'],
    terms: ['مرايه', 'مرايات', 'مرايا', 'مراه', 'مرايه جانبيه', 'mirror', 'mirrors', 'side mirror'],
  },
  {
    id: 'bumper',
    label: { ar: 'صدام (دعامية)', en: 'Bumper' },
    categoryId: 'body',
    carried: true,
    arts: ['bumper'],
    terms: ['صدام', 'صدامات', 'دعاميه', 'دعاميات', 'bumper', 'bumpers'],
  },

  // ── not carried yet
  {
    id: 'tires',
    label: { ar: 'كفرات (إطارات)', en: 'Tires' },
    carried: false,
    terms: ['كفر', 'كفرات', 'اطار', 'اطارات', 'تاير', 'تواير', 'tire', 'tires', 'tyre', 'tyres'],
  },
];

/** Extra colloquial / spelling aliases for vehicle reference data (keys: make or model ids). */
export const VEHICLE_ALIASES: Record<string, string[]> = {
  toyota: ['تويوتا', 'toyota'],
  hyundai: ['هونداي', 'هيونداي', 'هيونداى', 'hyundai'],
  nissan: ['نيسان', 'nissan'],
  ford: ['فورد', 'ford'],
  chevrolet: ['شفر', 'شفروليه', 'شيفروليه', 'شيفرولية', 'chevy', 'chevrolet'],
  gmc: ['جمس', 'جي ام سي', 'gmc'],
  kia: ['كيا', 'kia'],
  lexus: ['لكزس', 'لكسز', 'lexus'],
  camry: ['كامري', 'كامرى', 'camry'],
  'land-cruiser': ['لاندكروزر', 'لاند كروزر', 'لاند كروز', 'لاندكروز', 'landcruiser', 'land cruiser'],
  hilux: ['هايلكس', 'هايلوكس', 'هيلكس', 'hilux'],
  corolla: ['كورولا', 'كرولا', 'corolla'],
  elantra: ['النترا', 'الينترا', 'النتره', 'elantra'],
  sonata: ['سوناتا', 'سوناتة', 'sonata'],
  tucson: ['توسان', 'توكسان', 'tucson'],
  accent: ['اكسنت', 'اكسينت', 'accent'],
  patrol: ['باترول', 'patrol'],
  altima: ['التيما', 'altima'],
  sunny: ['صني', 'sunny'],
  taurus: ['توروس', 'تورس', 'taurus'],
  f150: ['اف 150', 'اف150', 'اف-150', 'f150', 'f 150', 'f-150'],
  tahoe: ['تاهو', 'tahoe'],
  yukon: ['يوكن', 'يوكون', 'yukon'],
  k5: ['كي 5', 'كي5', 'k5'],
  sportage: ['سبورتاج', 'سبورتيج', 'sportage'],
  lx: ['ال اكس', 'lx'],
};

/** Words that carry no part or vehicle meaning ("ابي فحمات حق كامري"). */
export const STOPWORDS = new Set([
  'حق', 'حقت', 'حقه', 'حقها', 'مال', 'ل', 'لل', 'في', 'من', 'على', 'او', 'و', 'مع', 'ابي', 'ابغى', 'ابغي', 'ابى', 'ودي', 'احتاج', 'ابحث', 'عن', 'اريد', 'بدي',
  'سياره', 'سيارتي', 'السياره', 'قطعه', 'قطع', 'غيار', 'موديل', 'سنه', 'نوع', 'رقم', 'جديد', 'اصلي', 'تجاري',
  'for', 'the', 'of', 'a', 'an', 'and', 'my', 'car', 'part', 'parts', 'model', 'year', 'new', 'need', 'want', 'to', 'with',
]);

// ───────────────────────────────────────────── normalisation

/** Same folding as src/lib/text.ts → normalizeText (Arabic letter variants, tashkeel, digits, case). */
export function foldText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[‎‏⁦-⁩]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
}

const SPLIT = /[\s,،;؛:!؟?()[\]{}"'«»—–|+*]+/;
const ARABIC = /[؀-ۿ]/;

/** Splits raw text into display tokens and folded tokens with the same length/order. */
export function tokenize(raw: string): { raw: string[]; folded: string[] } {
  const rawTokens: string[] = [];
  const folded: string[] = [];
  for (const piece of raw.split(SPLIT)) {
    const f = foldText(piece).replace(/^[-./]+|[-./]+$/g, '');
    if (!f) continue;
    rawTokens.push(piece);
    folded.push(f);
  }
  return { raw: rawTokens, folded };
}

/**
 * Light Arabic stemmer for matching only (never displayed): strips the definite article and common
 * plural/feminine suffixes while leaving at least three letters. Latin words lose a plural "s".
 */
export function stemToken(token: string): string {
  let t = token;
  if (ARABIC.test(t)) {
    for (const p of ['وال', 'بال', 'فال', 'كال', 'لل', 'ال']) {
      if (t.startsWith(p) && t.length - p.length >= 3) {
        t = t.slice(p.length);
        break;
      }
    }
    for (const s of ['ات', 'ين', 'ون', 'ه']) {
      if (t.endsWith(s) && t.length - s.length >= 3) {
        t = t.slice(0, -s.length);
        break;
      }
    }
    return t;
  }
  if (/^[a-z]{3,}s$/.test(t) && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/** True when two words differ by at most one insertion, deletion, substitution or adjacent swap. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff.push(k);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

// ───────────────────────────────────────────── concept index

type PhraseIndex = { exact: Map<string, Set<string>>; stemmed: Map<string, Set<string>>; maxWords: number };

let conceptIndexCache: PhraseIndex | null = null;
const conceptById = new Map(CONCEPTS.map((c) => [c.id, c]));

function add(map: Map<string, Set<string>>, key: string, id: string) {
  const set = map.get(key);
  if (set) set.add(id);
  else map.set(key, new Set([id]));
}

function conceptIndex(): PhraseIndex {
  if (conceptIndexCache) return conceptIndexCache;
  const idx: PhraseIndex = { exact: new Map(), stemmed: new Map(), maxWords: 1 };
  for (const c of CONCEPTS) {
    for (const term of c.terms) {
      const words = tokenize(term).folded;
      if (!words.length) continue;
      idx.maxWords = Math.max(idx.maxWords, words.length);
      add(idx.exact, words.join(' '), c.id);
      add(idx.stemmed, words.map(stemToken).join(' '), c.id);
    }
  }
  conceptIndexCache = idx;
  return idx;
}

export function getConcept(id: string): Concept | undefined {
  return conceptById.get(id);
}

/** A broad category concept ("فرامل", "فلتر") rather than a specific part. */
export function isCategoryConcept(id: string): boolean {
  const c = conceptById.get(id);
  return !!c?.categories && !c.arts;
}

export type ConceptSpan = { start: number; end: number; term: string; conceptIds: string[] };

/**
 * Greedy longest-phrase matching of concept terms over folded tokens. Exact forms win over stemmed
 * forms, so "شمعة" (headlight) and "شمعات" (shocks / plugs) stay distinct.
 * `skip[i]` marks tokens already consumed (vehicle, year, part number).
 */
export function findConcepts(tokens: string[], skip: boolean[] = []): ConceptSpan[] {
  const idx = conceptIndex();
  const spans: ConceptSpan[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (skip[i]) {
      i++;
      continue;
    }
    let found: ConceptSpan | null = null;
    for (let n = Math.min(idx.maxWords, tokens.length - i); n >= 1 && !found; n--) {
      const slice = tokens.slice(i, i + n);
      if (slice.some((_, k) => skip[i + k])) continue;
      const hit = idx.exact.get(slice.join(' ')) ?? idx.stemmed.get(slice.map(stemToken).join(' '));
      if (hit) found = { start: i, end: i + n, term: slice.join(' '), conceptIds: [...hit] };
    }
    if (found) {
      spans.push(found);
      i = found.end;
    } else i++;
  }
  return spans;
}

/**
 * Concept ids that describe a product. Names are authoritative ("فلتر زيت" is an oil filter even though
 * its keywords also say "زيت"); keywords, then art/category, only fill gaps when a name says nothing.
 */
export function productConcepts(p: { nameAr: string; nameEn: string; categoryId: string; art?: string | null; keywords?: string[] }): string[] {
  const ids = new Set<string>();
  const fromText = (texts: string[]) => {
    for (const text of texts) for (const span of findConcepts(tokenize(text).folded)) span.conceptIds.forEach((id) => ids.add(id));
  };
  const isSpecific = () => [...ids].some((id) => !isCategoryConcept(id));
  fromText([p.nameAr, p.nameEn]);
  if (!isSpecific() && p.keywords?.length) fromText(p.keywords);
  const specific = isSpecific();
  for (const c of CONCEPTS) {
    if (c.categories?.includes(p.categoryId)) ids.add(c.id);
    // Art is only trusted when it agrees with the category (merchant products inherit the category's art).
    if (!specific && p.art && c.arts?.includes(p.art) && c.categoryId === p.categoryId) ids.add(c.id);
  }
  return [...ids].sort();
}

/** The token stored in Product.searchText for a concept, e.g. "{brakepads}". Braces never occur in folded text. */
export function conceptToken(id: string): string {
  return `{${id.toLowerCase()}}`;
}

/** Concept tokens plus every folded surface form, appended to Product.searchText so plain text search also finds colloquial words. */
export function conceptSearchTerms(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const c = conceptById.get(id);
    if (!c) continue;
    out.add(conceptToken(id));
    for (const term of c.terms) out.add(tokenize(term).folded.join(' '));
  }
  return [...out];
}

// ───────────────────────────────────────────── vehicles

export type LexModel = { id: string; makeId?: string; name: LexText; yearFrom: number; yearTo: number };
export type LexMake = { id: string; name: LexText; models: LexModel[] };

type VehicleHit = { makeId: string; modelId?: string };
type VehicleIndex = { phrases: Map<string, VehicleHit>; maxWords: number; models: Map<string, LexModel & { makeId: string }> };

const vehicleIndexCache = new WeakMap<LexMake[], VehicleIndex>();

function vehicleIndex(makes: LexMake[]): VehicleIndex {
  const cached = vehicleIndexCache.get(makes);
  if (cached) return cached;
  const idx: VehicleIndex = { phrases: new Map(), maxWords: 1, models: new Map() };
  const put = (phrase: string, hit: VehicleHit) => {
    const words = tokenize(phrase).folded;
    if (!words.length) return;
    const key = words.join(' ');
    // A model alias always wins over a make alias with the same spelling.
    if (idx.phrases.has(key) && !hit.modelId) return;
    idx.phrases.set(key, hit);
    idx.maxWords = Math.max(idx.maxWords, words.length);
  };
  for (const make of makes) {
    for (const phrase of [make.name.ar, make.name.en, ...(VEHICLE_ALIASES[make.id] ?? [])]) put(phrase, { makeId: make.id });
  }
  for (const make of makes) {
    for (const model of make.models) {
      idx.models.set(model.id, { ...model, makeId: make.id });
      const hit = { makeId: make.id, modelId: model.id };
      for (const phrase of [model.name.ar, model.name.en, model.name.en.replace(/[\s-]+/g, ''), ...(VEHICLE_ALIASES[model.id] ?? [])]) put(phrase, hit);
    }
  }
  vehicleIndexCache.set(makes, idx);
  return idx;
}

// ───────────────────────────────────────────── query analysis

export type QueryAnalysis = {
  raw: string;
  /** Folded tokens, aligned with `rawTokens`. */
  tokens: string[];
  rawTokens: string[];
  /** The whole query is a part number (compact form), e.g. "04465-X3301" → "04465x3301". */
  partNumber: string | null;
  /** Part-number-looking tokens inside a longer query. */
  partNumbers: string[];
  concepts: ConceptSpan[];
  /** One OR-group per matched phrase; a product must satisfy every group. */
  conceptGroups: string[][];
  vehicle: { makeId: string; modelId?: string; start: number; end: number } | null;
  year: number | null;
  yearIndex: number | null;
  /** Remaining meaningful words (brand, side, material…), matched as text. */
  freeTokens: string[];
};

const YEAR = /^(19[5-9]\d|20\d\d|2100)$/;

function compactPartNumber(s: string): string {
  return foldText(s).replace(/[^a-z0-9]/g, '');
}

function looksLikePartNumberToken(token: string): boolean {
  const compact = compactPartNumber(token);
  if (compact.length < 5 || YEAR.test(compact)) return false;
  return /\d/.test(compact) && (/[a-z]/.test(compact) || /[-.]/.test(token) || compact.length >= 7);
}

function stripVehiclePrefix(token: string): string[] {
  const out = [token];
  for (const p of ['لل', 'ال', 'ل']) if (token.startsWith(p) && token.length - p.length >= 2) out.push(token.slice(p.length));
  return out;
}

export function analyzeQuery(raw: string, makes: LexMake[] = []): QueryAnalysis {
  const { raw: rawTokens, folded: tokens } = tokenize(raw);
  const base: QueryAnalysis = { raw, tokens, rawTokens, partNumber: null, partNumbers: [], concepts: [], conceptGroups: [], vehicle: null, year: null, yearIndex: null, freeTokens: [] };
  if (!tokens.length) return base;

  const trimmed = raw.trim();
  if (!/\s/.test(trimmed) && looksLikePartNumberToken(trimmed)) return { ...base, partNumber: compactPartNumber(trimmed) };

  const skip = tokens.map(() => false);
  tokens.forEach((t, i) => {
    if (base.year === null && YEAR.test(t)) {
      base.year = Number(t);
      base.yearIndex = i;
      skip[i] = true;
    } else if (looksLikePartNumberToken(t)) {
      base.partNumbers.push(compactPartNumber(t));
      skip[i] = true;
    }
  });

  if (makes.length) {
    const vidx = vehicleIndex(makes);
    let best: QueryAnalysis['vehicle'] = null;
    for (let i = 0; i < tokens.length && !best?.modelId; i++) {
      for (let n = Math.min(vidx.maxWords, tokens.length - i); n >= 1; n--) {
        if (tokens.slice(i, i + n).some((_, k) => skip[i + k])) continue;
        const rest = tokens.slice(i + 1, i + n).join(' ');
        const hit = stripVehiclePrefix(tokens[i]).map((first) => vidx.phrases.get(rest ? `${first} ${rest}` : first)).find(Boolean);
        if (hit && (!best || (hit.modelId && !best.modelId))) best = { ...hit, start: i, end: i + n };
        if (hit) break;
      }
    }
    if (best) {
      for (let k = best.start; k < best.end; k++) skip[k] = true;
      // "تويوتا كامري": swallow a make word right before or after the model.
      for (const k of [best.start - 1, best.end]) {
        if (k < 0 || k >= tokens.length || skip[k]) continue;
        const near = stripVehiclePrefix(tokens[k]).map((t) => vidx.phrases.get(t)).find(Boolean);
        if (near && !near.modelId && near.makeId === best.makeId) {
          skip[k] = true;
          best = { ...best, start: Math.min(best.start, k), end: Math.max(best.end, k + 1) };
        }
      }
      base.vehicle = best;
    }
  }

  base.concepts = findConcepts(tokens, skip);
  const groups = new Map<string, string[]>();
  for (const span of base.concepts) {
    for (let k = span.start; k < span.end; k++) skip[k] = true;
    groups.set([...span.conceptIds].sort().join('|'), [...span.conceptIds].sort());
  }
  base.conceptGroups = [...groups.values()];
  base.freeTokens = tokens.filter((t, i) => !skip[i] && !STOPWORDS.has(t) && !(t.length === 1 && ARABIC.test(t)));
  return base;
}

/** Text variants a free token may match in searchText: itself and its stem. */
export function tokenVariants(token: string): string[] {
  const stem = stemToken(token);
  return stem !== token && stem.length >= 3 ? [token, stem] : [token];
}

/** The query without the vehicle words and year — what removing the vehicle chip searches for. */
export function stripVehicleFromQuery(a: QueryAnalysis): string {
  return a.rawTokens.filter((_, i) => !(a.vehicle && i >= a.vehicle.start && i < a.vehicle.end) && i !== a.yearIndex).join(' ');
}

/**
 * Suggests a corrected query when a free word is one edit away from a known part term
 * (e.g. "فحمت" → "فحمات"). Returns null when nothing better is known.
 */
export function suggestCorrection(a: QueryAnalysis): string | null {
  if (!a.freeTokens.length) return null;
  const idx = conceptIndex();
  const singleWords = [...idx.exact.keys()].filter((k) => !k.includes(' ') && k.length >= 3);
  let changed = false;
  const out = a.tokens.map((t) => {
    if (!a.freeTokens.includes(t) || t.length < 3) return t;
    const fix = singleWords.find((w) => Math.abs(w.length - t.length) <= 1 && withinOneEdit(w, t));
    if (!fix) return t;
    changed = true;
    return fix;
  });
  return changed ? out.join(' ') : null;
}

// ───────────────────────────────────────────── vehicle resolution

export type GarageVehicleRef = { makeId?: string; modelId: string; year: number; engine?: string };

export type ResolvedVehicle = {
  source: 'query' | 'garage';
  makeId?: string;
  modelId?: string;
  year?: number;
  /** Only known when it comes from the selected vehicle for the same model and year. */
  engine?: string;
  /** How precise a fitment claim can be: a specific vehicle, any year of a model, or any model of a make. */
  scope: 'vehicle' | 'model' | 'make';
  /** The typed year is outside the model's production range. */
  yearOutOfRange?: boolean;
};

export function resolveVehicle(a: QueryAnalysis, garage: GarageVehicleRef | undefined, makes: LexMake[] = []): ResolvedVehicle | null {
  const models = makes.length ? vehicleIndex(makes).models : new Map<string, LexModel & { makeId: string }>();
  const garageMake = garage ? garage.makeId ?? models.get(garage.modelId)?.makeId : undefined;
  const fromGarage = (year: number): ResolvedVehicle => ({
    source: garage && year === garage.year && !a.vehicle && a.year === null ? 'garage' : 'query',
    makeId: garageMake,
    modelId: garage!.modelId,
    year,
    engine: year === garage!.year ? garage!.engine || undefined : undefined,
    scope: 'vehicle',
  });
  const withRange = (v: ResolvedVehicle): ResolvedVehicle => {
    const m = v.modelId ? models.get(v.modelId) : undefined;
    return m && v.year !== undefined && (v.year < m.yearFrom || v.year > m.yearTo) ? { ...v, yearOutOfRange: true } : v;
  };
  const q = a.vehicle;
  if (!q) {
    if (!garage) return null;
    return withRange(fromGarage(a.year ?? garage.year));
  }
  if (q.modelId) {
    if (garage && garage.modelId === q.modelId) return withRange(fromGarage(a.year ?? garage.year));
    if (a.year !== null) return withRange({ source: 'query', makeId: q.makeId, modelId: q.modelId, year: a.year, scope: 'vehicle' });
    return { source: 'query', makeId: q.makeId, modelId: q.modelId, scope: 'model' };
  }
  if (garage && garageMake === q.makeId) return withRange(fromGarage(a.year ?? garage.year));
  return { source: 'query', makeId: q.makeId, scope: 'make' };
}
