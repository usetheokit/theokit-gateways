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
 * The prose a reader actually sees.
 *
 * WHAT THIS DEFENDS AGAINST, AND WHAT IT DOES NOT.
 *
 * The threat is a section that quietly stops being there: deleted in a tidy-up, commented out
 * during a rewrite, or pasted into an example. Those happen by accident, and they are what this
 * blanks — HTML comments and fenced code (``` or ~~~, indented up to three spaces, closer at least
 * as long as its opener).
 *
 * The two are treated ASYMMETRICALLY when they never close, because the accidents are not the same
 * one. A forgotten closing fence is the commonest markdown typo there is and its consequence is
 * precisely the threat — everything after it, section included, renders as code — so a fence runs
 * to end of file. An unterminated comment does not: `<!--` shows up in ordinary prose about
 * commenting things out, and running that to end of file reported documented sections as missing.
 * For the same reason a comment opens only at the start of a line.
 *
 * Link TARGETS go too — inline `](url)`, reference definitions, and bare `<http…>` autolinks —
 * because a URL that contains a word is not a sentence naming it; a link LABEL stays.
 *
 * It does NOT defend against an author hiding a heading on purpose. `<script>`, `<pre>`,
 * `<textarea>` and `<div>` are HTML blocks CommonMark treats as raw, and a heading inside one is
 * invisible to a reader and visible here. That is deliberate: an author willing to do that can equally write a
 * section that names every fact and says something false, which this gate has never checked, and
 * chasing each new construct cost four rounds of review and four FALSE FAILS on innocent documents
 * — a `<!--` written in prose was enough to report the documented section missing. A false fail
 * lands on someone who did nothing wrong, and it is what teaches a team to stop reading the gate.
 *
 * For the same reason an unterminated block is not treated as hiding anything, even though
 * CommonMark runs one to end of file.
 *
 * @param {string} text
 * @returns {string}
 */
export function visibleText(text) {
  return stripLinkTargets(blankBlocks(text));
}

/**
 * What opens a block the reader does not read, and what closes it.
 *
 * One function so the kinds share a shape: a line opens, a later line closes, everything between is
 * not prose. Fences honour CommonMark's length rule — a closer must be at least as long as its
 * opener — which is both a bypass (a short line closing a long fence) and a false fail (a
 * three-backtick fence legitimately closed with four) when it is missing.
 *
 * A comment only opens when it is still open at end of line: `<!-- note --> <!--` opens, and
 * `<!-- note -->` does not. Getting that backwards produced a bypass and a false fail at once.
 *
 * @param {string} line
 * @param {number} index
 * @returns {{start: number, close: RegExp} | undefined}
 */
function openBlock(line, index) {
  const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (fence !== null) {
    const [marker] = fence.slice(1);
    return {
      start: index,
      close: new RegExp(`^ {0,3}\\${marker[0]}{${marker.length},}\\s*$`),
      runsToEof: true,
    };
  }

  if (/^\s*<!--/.test(line) && stillOpen(line, "<!--", "-->")) {
    return { start: index, close: /-->/, runsToEof: false };
  }
  return undefined;
}

/**
 * Whether `open` is the last of the two markers on this line — i.e. the block it starts is still
 * open when the line ends.
 *
 * @param {string} line
 * @param {string} open
 * @param {string} close
 * @returns {boolean}
 */
function stillOpen(line, open, close) {
  const opened = line.toLowerCase().lastIndexOf(open.toLowerCase());
  return opened !== -1 && opened > line.toLowerCase().lastIndexOf(close.toLowerCase());
}

/**
 * Blanks every block that opens AND closes, keeping line count.
 *
 * A block that never closes is discarded rather than run to end of file. CommonMark does run an
 * unterminated fence or comment to EOF, and honouring that produced four false fails on innocent
 * documents — `<!--` written in prose, a four-backtick fence, a commented-out draft — each of which
 * blanked the rest of the file and reported the documented section missing.
 *
 * That is the trade, stated rather than implied: an author who deliberately opens a block and never
 * closes it can hide a heading from this gate. Someone willing to do that can equally write a
 * section that names every fact and says something false, which this gate does not check either. A
 * false fail, by contrast, happens to someone who did nothing wrong, and it is what teaches a team
 * to stop reading the gate's output.
 *
 * @param {string} text
 * @returns {string}
 */
function blankBlocks(text) {
  const lines = text.split("\n");
  const hidden = new Set();
  let open;

  lines.forEach((line, index) => {
    if (open === undefined) {
      open = openBlock(line, index);
      return;
    }
    if (!open.close.test(line)) return;
    for (let i = open.start; i <= index; i++) hidden.add(i);
    open = undefined;
  });

  if (open !== undefined && open.runsToEof) {
    for (let i = open.start; i < lines.length; i++) hidden.add(i);
  }

  return lines.map((line, i) => (hidden.has(i) ? "" : line)).join("\n");
}

/**
 * Removes every link TARGET, keeping labels, and single-line HTML comments.
 *
 * A URL that contains a word is not a sentence naming it. Inline `](url)`, reference definitions
 * `[id]: url` and autolinks `<url>` all hid a fact from an earlier version of this gate.
 *
 * @param {string} text
 * @returns {string}
 */
function stripLinkTargets(text) {
  return text
    .replace(/<!--.*?-->/g, " ")
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
