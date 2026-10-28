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
const punctuationOnly = (value: string) => !/[\p{L}\p{N}]/u.test(value);
const numericSeparator = (value: string) => value === 'x' || value === '×' || punctuationOnly(value);

function tokens(value: string): string[] {
  const chunks = normalizeTypography(value).match(/\S+/gu) ?? [];
  const result: string[] = [];
  const numeric = chunks.some(hasNumber);
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    if (!hasNumber(chunk)) {
      // Ordinary punctuation still separates words, but literal operators in a
      // numeric search must not disappear (including an incomplete expression).
      result.push(...(chunk.match(/[\p{L}\p{M}]+/gu) ?? (numeric ? [chunk] : [])));
      continue;
    }
    let end = index;
    while (end + 1 < chunks.length) {
      const next = chunks.findIndex((candidate, candidateIndex) => candidateIndex > end && hasNumber(candidate));
      if (next < 0) break;
      const bridge = chunks.slice(end + 1, next);
      // Preserve explicit expressions verbatim, not as reordered operands:
      // 1 / 4, 1 x 2, 1 mm x 2 mm, and longer chains. This does not evaluate
      // expressions, identify units, or equate compact and spaced dimensions.
      if (bridge.length && !bridge.some(numericSeparator)) break;
      end = next;
    }
    while (end + 1 < chunks.length && punctuationOnly(chunks[end + 1])) end++;
    // Every attached character matters for numeric identifiers, not only a
    // selected separator list: ABC,123, ABC(123), 1,000 and 5% stay distinct.
    result.push(chunks.slice(index, end + 1).join(' '));
    index = end;
  }
  return result;
}

/**
 * AND search in any word order. Words support prefixes for partial typing;
 * numeric-bearing terms require a whole-token match, never a substring, and
 * keep their order and multiplicity. Explicit expressions retain their literal
 * intervening text. Conservative false negatives are preferable to substituting
 * another size: even trailing punctuation and compact/spaced syntax differ.
 * An unspecified measurement mark can find a marked size (5/32 -> 5/32"),
 * but an explicit foot/inch mark must match exactly (6' must not find 6").
 */
export function createInventoryMatcher(query: string): (fields: readonly (string | undefined | null)[]) => boolean {
  if (!query.trim()) return () => true;
  const terms = tokens(query);
  if (!terms.length) return () => false;
  return fields => {
    const candidates = fields.flatMap(field => typeof field === 'string' ? tokens(field) : []);
    let lastNumeric = -1;
    return terms.every(term => {
      if (!hasNumber(term)) return candidates.some(candidate => punctuationOnly(term) ? candidate === term : candidate.startsWith(term));
      const found = candidates.findIndex((candidate, index) => index > lastNumeric && (
        candidate === term || (!/["']$/.test(term) && /["']$/.test(candidate) && candidate.slice(0, -1) === term)
      ));
      if (found < 0) return false;
      lastNumeric = found;
      return true;
    });
  };
}
