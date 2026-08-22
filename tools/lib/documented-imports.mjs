// Extraction of the imports our documentation tells a reader to write.
//
// Separated from the gate that checks them so it can be unit-tested: every defect this extraction
// has had so far was a false POSITIVE — the gate accusing a document of naming something that does
// not exist, when the document was innocent and the instrument was wrong. A false positive in a
// gate is expensive twice: it costs the reading, and it teaches people to distrust the next report.

/** `import { A, type B } from "..."` — the shape a usage example uses. */
const IMPORT = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;

/**
 * Blanks the lines a reader is being moved AWAY from, keeping line numbers intact.
 *
 * A migration guide's ```diff block names the old API on purpose: `-import { payments } from "…"`
 * is the line being retired, not an instruction. Reading it as one reports drift against code the
 * documentation is explicitly aposentando — a guaranteed false positive in exactly the document
 * whose job is to describe a rename. Found by `theokit-plugins`, where it accounted for 3 of 22
 * initial findings.
 *
 * Only `-` inside a ```diff fence is dropped: `+` and context lines are what the reader should end
 * up with, and a `-` outside a diff fence is a list bullet.
 */
export function stripDiffRemovals(markdown) {
  let inDiff = false;
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      const fence = /^\s*```(\w*)/.exec(line);
      if (fence !== null) {
        if (inFence) {
          inFence = false;
          inDiff = false;
        } else {
          inFence = true;
          inDiff = fence[1] === "diff";
        }
        return line;
      }
      return inDiff && /^\s*-/.test(line) ? "" : line;
    })
    .join("\n");
}

/**
 * Documentation this is asked about, given every tracked markdown path.
 *
 * `.changeset/` describes a release rather than an API. `CHANGELOG.md` is the same in a stronger
 * form: an entry reading "removed `defineStripeWebhook`" names a symbol that no longer exists ON
 * PURPOSE, and a released entry is immutable (Unbreakable Rule 6). Checking either would demand
 * rewriting history to satisfy an instrument.
 */
export function isDocumentation(path) {
  if (path.startsWith(".changeset/")) return false;
  return path !== "CHANGELOG.md" && !path.endsWith("/CHANGELOG.md");
}

/**
 * Every import a document tells a reader to write.
 *
 * @param {string} file repo-relative path, used for reporting
 * @param {string} text the document's content
 * @returns {Array<{file: string, line: number, specifier: string, names: string[]}>}
 */
export function importsIn(file, text) {
  const claims = [];
  const scannable = stripDiffRemovals(text);
  for (const match of scannable.matchAll(IMPORT)) {
    const specifier = match[2];
    // A relative specifier points inside the example itself; there is no package to resolve.
    if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
    const names = match[1]
      .split(",")
      .map((name) => name.trim().replace(/^type\s+/, ""))
      // `…` and other ellipsis stand-ins are prose, not names a compiler could look up.
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
    if (names.length === 0) continue;
    claims.push({
      file,
      line: scannable.slice(0, match.index).split("\n").length,
      specifier,
      names,
    });
  }
  return claims;
}
