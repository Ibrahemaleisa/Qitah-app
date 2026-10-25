/** Normalises Arabic and Latin text for forgiving search matching. */
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

/** Part numbers are compared without separators: "04465-X3301" === "04465x3301". */
export function normalizePartNumber(input: string): string {
  return normalizeText(input).replace(/[^a-z0-9]/g, '');
}

export function looksLikePartNumber(query: string): boolean {
  const compact = normalizePartNumber(query);
  return compact.length >= 5 && /\d/.test(compact) && !/\s/.test(query.trim());
}

/** True when two words differ by at most one insertion, deletion, substitution or adjacent swap. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === b.length) {
    const diff = [...a].map((ch, k) => (ch === b[k] ? -1 : k)).filter((k) => k >= 0);
    if (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]) return true;
  }
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
