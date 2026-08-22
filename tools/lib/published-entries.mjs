// The published declaration entries of every workspace package, resolved ONE way.
//
// `check-dts-typechecks`, `check-doc-coverage` and `check-doc-api-drift` all need this list, and
// they must agree: if one gate checked an entry another never touched, a green run would mean less
// than it appears to. Sharing the resolution is what keeps them honest about looking at the same
// files.
//
// ENTRIES COME FROM THE `exports` FIELD, not from a guess at `dist/index.d.ts`. Every package here
// publishes a single `.` today, so this reads the same eleven files either way — but the earlier
// version hard-coded that assumption, and a sibling repository (`theokit-plugins`) proved what it
// costs: eleven packages, EIGHTEEN declaration entries, eight of them subpaths, one of them at
// `dist/stripe.d.ts` rather than `dist/stripe/index.d.ts`. Ported unchanged, the gates there would
// have measured 11 of 18 and reported a percentage that reads as whole-package coverage while
// leaving almost half the published surface unexamined. The manifest is the map a consumer's
// resolver reads; it is the map the gates read too.
//
// BOTH MODULE FORMATS. When a package publishes CJS declarations alongside ESM, both are entries:
// they are emitted separately and the defect that motivated `check-dts-typechecks` (#29) appeared
// identically in each, so checking one would leave half the consumers unprotected.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The declaration path a conditional-exports object points at, whichever spelling it uses. */
function declarationOf(condition) {
  if (typeof condition === "string") return undefined; // a bare path is JS, not types
  if (condition === null || typeof condition !== "object") return undefined;
  return (
    condition.types ??
    condition.import?.types ??
    condition.require?.types ??
    condition.default?.types
  );
}

/** The CJS declaration beside an ESM one, when the package publishes both. */
function cjsSibling(condition) {
  if (condition === null || typeof condition !== "object") return undefined;
  return condition.require?.types;
}

/**
 * One row per published declaration entry.
 *
 * @returns {Array<{pkg: string, specifier: string, decl: string}>} `specifier` is what a consumer
 * writes (`@theokit/gateway`, `@theokit/gateway/sub`); `decl` is the absolute path of the `.d.ts`
 * it resolves to. Only entries whose file exists are returned — the caller decides whether a
 * package with none is a failure, because "not built" and "declares none" are different facts.
 */
export function publishedEntries(meta, dir) {
  const rows = [];
  const seen = new Set();
  const add = (subpath, relative) => {
    if (typeof relative !== "string") return;
    const decl = join(dir, relative);
    if (!existsSync(decl) || seen.has(decl)) return;
    seen.add(decl);
    rows.push({
      pkg: meta.name,
      specifier: subpath === "." ? meta.name : `${meta.name}/${subpath.replace(/^\.\//, "")}`,
      decl,
    });
  };

  const exportsField = meta.exports;
  if (exportsField !== undefined && exportsField !== null && typeof exportsField === "object") {
    for (const [subpath, condition] of Object.entries(exportsField)) {
      if (subpath.includes("*")) continue; // a wildcard names no single file to check
      add(subpath, declarationOf(condition));
      add(subpath, cjsSibling(condition));
    }
  }
  // A package with no `exports` still publishes types through the legacy field.
  if (rows.length === 0) add(".", meta.types ?? meta.typings);
  return rows;
}

/**
 * @returns {Array<{name: string, dir: string, entries: string[], rows: Array<{specifier: string,
 * decl: string}>, built: boolean}>} one row per workspace package, in directory order. `built` is
 * false when no declared entry exists on disk — reported by the caller rather than skipped, because
 * a gate whose green can mean "there was nothing to check" is not a gate.
 */
export function publishedPackages() {
  const packagesDir = join(ROOT, "packages");
  const packages = [];
  for (const name of readdirSync(packagesDir).sort()) {
    const dir = join(packagesDir, name);
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const meta = JSON.parse(readFileSync(manifest, "utf8"));
    const rows = publishedEntries(meta, dir);
    packages.push({
      name: meta.name,
      dir,
      rows,
      entries: rows.map((row) => row.decl),
      built: rows.length > 0,
    });
  }
  return packages;
}

/**
 * `compilerOptions.paths` mapping every workspace specifier to its emitted declaration.
 *
 * Without this, a probe resolves our own packages through whatever `node_modules` link happens to
 * exist where it stands — and a link is not a contract. `integration/` declares all eleven today
 * only because its own tests need them; nothing obliges it to keep doing so. The cost of that
 * fragility rose sharply once an unresolvable specifier began being reported as out-of-scope rather
 * than as a failure: a dropped link would turn OUR drift into a silent skip. Mapping the workspace
 * explicitly means "out of scope" can only ever mean third-party.
 */
export function workspacePaths() {
  const paths = {};
  for (const pkg of publishedPackages()) {
    for (const row of pkg.rows) {
      if (!row.decl.endsWith(".d.ts")) continue; // one mapping per specifier; ESM types are it
      paths[row.specifier] ??= [row.decl];
    }
  }
  return paths;
}
