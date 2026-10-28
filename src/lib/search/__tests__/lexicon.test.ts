import { allMakes } from '@/data/vehicles';
import { analyzeQuery, foldText, resolveVehicle, stripVehicleFromQuery, suggestCorrection } from '@/lib/search/lexicon';
import { normalizeText } from '@/lib/text';

// The app's tsconfig has no Node types; jest runs on Node, so read the files through require('fs').
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node built-in, test only
const fs = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
const readSibling = (...parts: string[]) => fs.readFileSync([__dirname, ...parts].join('/'), 'utf8');

const groups = (q: string) => analyzeQuery(q, allMakes()).conceptGroups.map((g) => g.join('|'));

describe('shared search lexicon', () => {
  it('is byte-identical to the server copy (services/api/src/search/lexicon.ts)', () => {
    const app = readSibling('..', 'lexicon.ts');
    const server = readSibling('..', '..', '..', '..', 'services', 'api', 'src', 'search', 'lexicon.ts');
    expect(app).toBe(server);
  });

  it('folds text exactly like lib/text normalizeText', () => {
    for (const s of ['فحمات فرامل أمامية', 'إطارات', 'مرآة', 'بطاريةٌ', '٢٠٢٢', 'Camry']) expect(foldText(s)).toBe(normalizeText(s));
  });

  it.each([
    ['كفرات', 'tires'],
    ['اطارات', 'tires'],
    ['قربة', 'radiator'],
    ['بوجيهات', 'sparkPlugs'],
    ['هوبات', 'brakeRotors'],
    ['ديسكات', 'brakeRotors'],
    ['كلتش', 'clutch'],
    ['قير', 'transmission'],
    ['كمبروسر', 'acCompressor'],
    ['سلف', 'starter'],
    ['فحمات', 'brakePads'],
    ['بريك', 'brakePads'],
    ['طنابير', 'brakeRotors'],
    ['رديتر', 'radiator'],
    ['مساعدات', 'shock'],
    ['مارش', 'starter'],
    ['دينمو', 'alternator'],
    ['بطارية', 'battery'],
    ['جير', 'transmission'],
    ['دبرياج', 'clutch'],
    ['سيور', 'belt'],
    ['فلتر هوا', 'airFilter'],
    ['فلتر مكيف', 'cabinFilter'],
    ['زيوت', 'engineOil'],
    ['لمبات', 'lighting'],
    ['مرايه', 'mirror'],
    ['دعامية', 'bumper'],
    ['ماء رديتر', 'coolant'],
    ['الفحمات', 'brakePads'],
    ['brake pads', 'brakePads'],
  ])('%s → %s', (q, concept) => {
    expect(groups(q)).toEqual([concept]);
  });

  it('parses "فلتر زيت كامري 2022" into oilFilter + Camry + 2022 on the bundled vehicles', () => {
    const a = analyzeQuery('فلتر زيت كامري 2022', allMakes());
    expect(a.conceptGroups).toEqual([['oilFilter']]);
    expect(a.vehicle).toMatchObject({ makeId: 'toyota', modelId: 'camry' });
    expect(a.year).toBe(2022);
    expect(stripVehicleFromQuery(a)).toBe('فلتر زيت');
    expect(resolveVehicle(a, undefined, allMakes())).toEqual({ source: 'query', makeId: 'toyota', modelId: 'camry', year: 2022, scope: 'vehicle' });
  });

  it('suggests a correction one edit away', () => {
    expect(suggestCorrection(analyzeQuery('فحمت', allMakes()))).toBe('فحمات');
  });
});
