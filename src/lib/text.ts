/** Normalises Arabic and Latin text for forgiving search matching. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '') // tashkeel
    .replace(/ـ/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
}

/** Part numbers are compared without separators: "04465-X3301" === "04465x3301". */
export function normalizePartNumber(input: string): string {
  return normalizeText(input).replace(/[^a-z0-9]/g, '');
}

export function looksLikePartNumber(query: string): boolean {
  const compact = normalizePartNumber(query);
  return compact.length >= 5 && /\d/.test(compact) && !/\s/.test(query.trim());
}
