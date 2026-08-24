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
 * The prose a reader actually sees, with the hiding places listed below blanked out.
 *
 * Applied to the WHOLE document before the section is located, not to the section afterwards. The
 * first attempt stripped only the body, so a `## How this fits with TheoKit` line written inside an
 * HTML comment or a fenced code block defined a phantom section and the real one could be deleted —
 * the bypass this was meant to close, reached through the heading instead of the body.
 *
 * Blanked, not deleted: comments and fences are replaced by their own newlines so headings after
 * them still start a line.
 *
 * A fact counts when a reader can see it and it is being asserted. What is blanked, and nothing
 * else: HTML comments (invisible), fenced code — ``` or ~~~, indented up to three spaces, closed or
 * running to end of file as CommonMark says they do — and every link TARGET: inline `](url)`,
 * reference definitions `[id]: url`, and autolinks `<url>`, because a URL that contains a word is
 * not a sentence naming it. A link LABEL survives: naming the repository in the text of a link is
 * naming it. Four-space indented code is NOT blanked — it is ordinary content, and treating it as a
 * fence would swallow the rest of the document.
 *
 * This list is what is covered, not a claim that nothing else hides text. An earlier version of
 * this docblock said "every hiding place" and four bypasses were found the same afternoon.
 *
 * @param {string} text
 * @returns {string}
 */
export function visibleText(text) {
  return stripLinkTargets(blankComments(blankFences(text)));
}

/**
 * Blanks fenced code blocks, keeping line count.
 *
 * CommonMark: a fence opens on ``` or ~~~ indented up to three spaces, closes on the same marker,
 * and runs to end of file when it never closes. Four-space indentation is an indented code block,
 * not a fence — treating it as one would swallow the rest of the document.
 *
 * @param {string} text
 * @returns {string}
 */
function blankFences(text) {
  let marker;
  return text
    .split("\n")
    .map((line) => {
      if (marker !== undefined) {
        if (new RegExp(`^ {0,3}${marker}\\s*$`).test(line)) marker = undefined;
        return "";
      }
      const opener = /^ {0,3}(```|~~~)/.exec(line);
      if (opener === null) return line;
      marker = opener[1];
      return "";
    })
    .join("\n");
}

/**
 * Blanks HTML comments, including one that is never closed — which runs to end of file.
 *
 * Runs after `blankFences`, so a comment marker inside a code example is already gone. The reverse
 * order would let a fence written inside a comment blank the rest of the document.
 *
 * @param {string} text
 * @returns {string}
 */
function blankComments(text) {
  let open = false;
  const lines = text.split("\n").map((line) => {
    if (open) {
      if (line.includes("-->")) open = false;
      return "";
    }
    if (line.includes("<!--") && !line.includes("-->")) {
      open = true;
      return "";
    }
    return line;
  });
  return lines.join("\n").replace(/<!--.*?-->/g, " ");
}

/**
 * Removes every link TARGET, keeping labels.
 *
 * A URL that contains a word is not a sentence naming it. Inline `](url)`, reference definitions
 * `[id]: url` and autolinks `<url>` all hid a fact from an earlier version of this gate.
 *
 * @param {string} text
 * @returns {string}
 */
function stripLinkTargets(text) {
  return text
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/^\s*\[[^\]]+\]:.*$/gm, "")
    .replace(/<https?:\/\/[^>]*>/g, "");
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

  const body = sectionBody(visibleText(text), heading);
  if (body === undefined) return [`${file}: has no \`## ${heading}\` section`];

  return facts
    .filter((fact) => !boundedPattern(fact).test(body))
    .map((fact) => `${file}: \`## ${heading}\` never names ${fact}`);
}
