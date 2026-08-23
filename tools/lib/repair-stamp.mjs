// Did the declaration repair run over THIS build?
//
// One fact, kept apart from the gate that reports it, because the gate's whole value is that it
// states facts rather than explanations. `check-dts-typechecks.mjs` already separates "does not
// compile" from "was never built", on the stated grounds that merging different facts describes a
// defect that may not exist. "Was built but never repaired" is a third such fact, and until it was
// separated the gate answered it with the first one — naming the published artifact for a state
// that is never published.
//
// The cost of not having it, measured: `pnpm -r build` runs each package's own build script and
// stops. The repair lives in the second half of the ROOT script, so the recursive form leaves the
// declarations mid-flight, the gate reports five packages publishing something broken, and the
// reader has no way to tell that from a real regression. It produced one issue filed against a
// defect that did not exist.
//
// @module

import { statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where the repair records that it ran. Gitignored: it describes a working tree, not the source. */
export const STAMP_FILE = ".dts-repair-stamp";

/**
 * Whether the repair ran after the declarations it would have repaired were written.
 *
 * Equality counts as ran. Filesystem mtime granularity can collapse a repair and the build it
 * followed into one millisecond, and reading that as stale would make the hint fire on a correct
 * build — a gate that explains away a real breakage is worse than one that is merely unhelpful.
 *
 * @param {number | undefined} stampMs when the repair last ran, or undefined if it never has
 * @param {number | undefined} newestDeclarationMs the most recently written declaration, or
 *   undefined when nothing is built — in which case nothing was repaired either, whatever the
 *   stamp says.
 * @returns {boolean}
 */
export function repairRanOverBuild(stampMs, newestDeclarationMs) {
  if (stampMs === undefined || newestDeclarationMs === undefined) return false;
  return stampMs >= newestDeclarationMs;
}

/**
 * Record that the repair has run. Called by `repair-dts-imports.mjs` on success only.
 *
 * @param {string} root
 * @param {number} [atMs] the moment to record; defaults to now. Injected by tests so the stamp
 *   does not depend on a clock they cannot control.
 */
export function writeRepairStamp(root, atMs) {
  const path = join(root, STAMP_FILE);
  writeFileSync(path, "Written by tools/repair-dts-imports.mjs. Not source; safe to delete.\n");
  if (atMs !== undefined) {
    const seconds = atMs / 1000;
    utimesSync(path, seconds, seconds);
  }
}

/**
 * When the repair last ran, or undefined if it never has.
 *
 * @param {string} root
 * @returns {number | undefined}
 */
export function readRepairStamp(root) {
  try {
    return statSync(join(root, STAMP_FILE)).mtimeMs;
  } catch {
    return undefined;
  }
}
