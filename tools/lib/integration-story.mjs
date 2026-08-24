// Whether a document actually tells the integration story, or merely contains its vocabulary.
//
// The first version of this gate looked the facts up across the whole file. A review showed what
// that bought: both sections could be DELETED and replaced with sentences denying the relationship
// ("We do not use handleChannelWebhook and we do not depend on theokit-sdk"), and the gate still
// answered `PASS — 2 document(s) name the seam`. Two of the three root-README facts were already
// satisfied before the section existed at all — by the H1 title and a 2026-06 provenance line — so
// exactly one of the three was load-bearing, and it counted from anywhere in the file.
//
// Scope is the fix: a fact counts inside the section that is supposed to carry it, in visible prose.
//
// WHAT THIS STILL DOES NOT ASSERT. It checks presence within a scope, never accuracy. A section
// naming both repositories and assigning the halves backwards passes, and so does a sentence inside
// the section that denies the relationship while quoting the symbol. No presence gate can catch
// that; saying so is cheaper than a gate that pretends otherwise. Accuracy is what review is for —
// and it is what review caught here, in the prose this gate had waved through.
//
// It deliberately does not check phrasing. A vocabulary gate over prose makes the prose
// unchangeable: rewriting "TheoKit's channel webhook" more clearly would fail it, and the next
// author would learn to paste the magic words back and ignore the meaning — the hollow section this
// gate exists to prevent, arrived at from the other direction. So it asserts only what cannot be
// paraphrased without ceasing to be the fact: an exported symbol name and a repository name.
//
// @module

/** Regex-escape a fact so it matches literally. */
function escapeForRegex(fact) {
  return fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A pattern matching `fact` as a whole name.
 *
 * `\b` is not enough: `theokit-sdk` ends on a non-word character, so `\btheokit-sdk\b` also matches
 * inside `theokit-sdk-experimental` — a different repository. Hyphens are part of these names, so
 * the boundary has to exclude them on both sides.
 *
 * @param {string} fact
 * @returns {RegExp}
 */
export function boundedPattern(fact) {
  return new RegExp(`(?<![\\w-])${escapeForRegex(fact)}(?![\\w-])`);
}

/**
 * The body of the `## {heading}` section, or undefined when the document has no such section.
 *
 * Stops at the next heading of the same or higher level, so a subsection still counts as part of
 * the story while the following top-level section does not.
 *
 * @param {string} text the whole document
 * @param {string} heading the section title, without its `##`
 * @returns {string | undefined}
 */
export function sectionBody(text, heading) {
  const start = new RegExp(`^##\\s+${escapeForRegex(heading)}\\s*$`, "m").exec(text);
  if (start === null) return undefined;

  const rest = text.slice(start.index + start[0].length);
  const next = /^##\s+\S/m.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

/**
 * The prose a reader actually sees, with the hiding places removed.
 *
 * HTML comments are invisible in rendered Markdown, and a link target is a URL rather than a claim
 * — both passed the first version of this gate. A link LABEL survives: naming the repository in the
 * text of a link is naming it.
 *
 * @param {string} body
 * @returns {string}
 */
export function visibleText(body) {
  return body.replace(/<!--[\s\S]*?-->/g, " ").replace(/\]\([^)]*\)/g, "]");
}

/**
 * Everything wrong with one document's integration story, or an empty list when nothing is.
 *
 * Returns reasons rather than a boolean because "no section", "not found" and "never names X" are
 * different problems with different fixes.
 *
 * @param {string | undefined} text the document, or undefined when it could not be read
 * @param {{file: string, heading: string, facts: readonly string[]}} required
 * @returns {string[]}
 */
export function missingFacts(text, { file, heading, facts }) {
  if (text === undefined) return [`${file}: not found`];

  const body = sectionBody(text, heading);
  if (body === undefined) return [`${file}: has no \`## ${heading}\` section`];

  const visible = visibleText(body);
  return facts
    .filter((fact) => !boundedPattern(fact).test(visible))
    .map((fact) => `${file}: \`## ${heading}\` never names ${fact}`);
}
