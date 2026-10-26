/** Same normalisation as the customer app (src/lib/text.ts) so search behaves identically. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // tashkeel
    .replace(/\u0640/g, '') // tatweel
    .replace(/[\u200E\u200F\u2066-\u2069]/g, '') // bidi marks / isolates
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
}
export function normalizePartNumber(input: string): string {
  return normalizeText(input).replace(/[^a-z0-9]/g, '');
}
export function looksLikePartNumber(query: string): boolean {
  const compact = normalizePartNumber(query);
  return compact.length >= 5 && /\d/.test(compact) && !/\s/.test(query.trim());
}
