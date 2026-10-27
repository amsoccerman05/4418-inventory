/**
 * Search only the fields already available to the current account. This is not a
 * fuzzy size/part-number lookup: digit-bearing tokens retain their punctuation,
 * leading zeros and unit marks. No fractions, dimensions or units are converted.
 */
function normalizeTypography(value: string): string {
  return value.normalize('NFC').toLowerCase()
    .replace(/[\u2010-\u2015\u2212\uff0d]/g, '-')
    .replace(/[\u2044\u2215\uff0f]/g, '/')
    .replace(/[\u201c\u201d\u2033\uff02]/g, '"')
    .replace(/[\u2018\u2019\u2032\uff07]/g, "'");
}

const hasNumber = (value: string) => /\p{N}/u.test(value);

function tokens(value: string): string[] {
  // A numeric-bearing compound is one token: 1/4-20, .5, ABC-001, M6, etc.
  // Alphabetic compounds instead split on punctuation: hex-head => hex, head.
  // Keep fields separate so their boundaries cannot manufacture an identifier.
  const compounds = normalizeTypography(value).match(
    /[#.+-]*[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[./_:+#@%=\-'"]+[\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*["']*/gu,
  ) ?? [];
  return compounds.flatMap(token => hasNumber(token)
    ? [token]
    : token.match(/[\p{L}\p{M}]+/gu) ?? []);
}

/**
 * AND search in any word order. Words support prefixes for partial typing;
 * numeric-bearing terms require a whole-token match, never a substring.
 * An unspecified measurement mark can find a marked size (5/32 -> 5/32"),
 * but an explicit foot/inch mark must match exactly (6' must not find 6").
 */
export function createInventoryMatcher(query: string): (fields: readonly (string | undefined | null)[]) => boolean {
  if (!query.trim()) return () => true;
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return () => false;
  return fields => {
    const candidates = fields.flatMap(field => typeof field === 'string' ? tokens(field) : []);
    return terms.every(term => candidates.some(candidate => {
      if (!hasNumber(term)) return candidate.startsWith(term);
      if (candidate === term) return true;
      return !/["']$/.test(term) && /["']$/.test(candidate) && candidate.slice(0, -1) === term;
    }));
  };
}
