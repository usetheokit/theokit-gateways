// Which decision ids a published declaration cites, and which of them are accounted for.
//
// The docblocks cite `D###` ids as evidence — "per ADR D426 the mapping stays in one place". A
// reader who follows one is entitled to find it, and for 59 of the 76 cited ids there was nothing
// to find: they were defined in implementation plans under `.claude/`, which is development tooling
// and is not versioned. The citations reached npm inside a `.d.ts` while the documents defining
// them stayed on one machine.
//
// Separated from the gate so the three decisions here — what counts as a citation, what counts as a
// row, what counts as unaccounted-for — are testable without building the packages.
//
// @module

/** `D` followed by exactly three digits, bounded so `D1234` and `XD170` are not ids. */
const ID = /(?<![A-Za-z0-9])D\d{3}(?![0-9])/g;

/**
 * The distinct ids a declaration cites, sorted.
 *
 * @param {string} text the contents of a `.d.ts`
 * @returns {string[]}
 */
export function citedIds(text) {
  return [...new Set(text.match(ID) ?? [])].sort();
}

/**
 * The ids the registry has a row for, whatever their status.
 *
 * A **lost** row counts. The gate asks that every citation be accounted for, not that a decision be
 * invented for an id whose origin is gone — inventing one would be worse than the silence it
 * replaced.
 *
 * @param {string} markdown the registry document
 * @returns {string[]}
 */
export function registeredIds(markdown) {
  return [
    ...new Set(markdown.match(/^\|\s*`(D\d{3})`/gm)?.map((row) => row.match(/D\d{3}/)[0]) ?? []),
  ].sort();
}

/**
 * Every citation with no row, as `{id, file}`.
 *
 * Reports all of them rather than the first, because a run that names one id per attempt costs a
 * build per citation.
 *
 * @param {Map<string, string>} files declaration path → contents
 * @param {string} registry the registry document
 * @returns {Array<{id: string, file: string}>}
 */
export function unregisteredCitations(files, registry) {
  const known = new Set(registeredIds(registry));
  const missing = [];
  for (const [file, text] of files) {
    for (const id of citedIds(text)) if (!known.has(id)) missing.push({ id, file });
  }
  return missing;
}
