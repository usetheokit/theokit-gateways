#!/usr/bin/env node
// Public-API documentation coverage, asked of the TypeScript compiler over the PUBLISHED
// declarations — the same question a consumer's editor asks when it renders a tooltip.
//
// WHY THE COMPILER AND NOT A REGEX. `getExportsOfModule` gives the real export list, with aliases
// followed to the declaration they point at, and `getDocumentationComment` says which of them a
// reader actually gets text for. Counting `/**` occurrences answers a different question and
// disagrees with this one by tens of points.
//
// WHY THE EMIT AND NOT THE SOURCE. A docblock in the source is not documentation until it survives
// the build. `stripInternal` removes a declaration outright when the literal `@internal` appears in
// any leading comment range, and the declaration rollup drops or relocates comments on its own. The
// file a consumer installs is the only one whose documentation is real.
//
// A DOCBLOCK WHOSE FIRST LINE BEGINS WITH `@` IS PARSED AS A TAG, and the whole block becomes that
// tag's value: `/** @theokit/gateway — ... */` yields no documentation at all and invents a tag
// named `theokit`. The comment is plainly visible in the `.d.ts` and reaches no reader. That shape
// is reported separately, because "you wrote documentation and got none" needs a different sentence
// than "you wrote none".
//
// THE FLOOR IS A RATCHET, NOT A TARGET. Raise it when the number rises; never lower it to make a run
// pass. A symbol that cannot be documented is a symbol that should not be exported.
//
// Usage: node tools/check-doc-coverage.mjs [--list <package>]

import { createRequire } from "node:module";
import { join } from "node:path";
import { publishedPackages, ROOT } from "./lib/published-entries.mjs";

const LABEL = "doc-coverage";
const ts = createRequire(import.meta.url)(join(ROOT, "node_modules/typescript"));

/**
 * Minimum share of published exports carrying documentation, per package.
 *
 * 100 because that is what was measured on 2026-08-20 after documenting the 47 exports this gate
 * first surfaced (163/163). It is a ratchet: a new export arrives documented, or the run goes red.
 * Never lower it to make a run pass — a symbol that cannot be documented is a symbol that should
 * not be exported.
 */
const FLOOR_PERCENT = 100;

const listIndex = process.argv.indexOf("--list");
const LIST = listIndex === -1 ? undefined : process.argv[listIndex + 1];

/** JSDoc tags TypeScript legitimately recognises. A first-line tag outside this set is prose the
 *  author did not mean as a tag — most often a package specifier. */
const KNOWN_TAGS = new Set([
  "param",
  "returns",
  "return",
  "throws",
  "example",
  "see",
  "deprecated",
  "internal",
  "public",
  "remarks",
  "defaultValue",
  "typeParam",
  "template",
  "since",
  "beta",
  "alpha",
  "experimental",
  "override",
  "readonly",
  "packageDocumentation",
  "module",
]);

/** Where one exported symbol lands: documented, undocumented, or documented-and-swallowed. */
function classify(symbol, checker) {
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const text = target
    .getDocumentationComment(checker)
    .map((part) => part.text)
    .join("")
    .trim();
  if (text.length > 0) return { kind: "documented" };
  // No documentation reached the reader. Distinguish "none written" from "written and swallowed":
  // a block whose first tag is not one TypeScript knows was prose the author expected to be read.
  const invented = (target.getJsDocTags(checker) ?? []).find((tag) => !KNOWN_TAGS.has(tag.name));
  return invented === undefined
    ? { kind: "undocumented" }
    : { kind: "swallowed", tag: invented.name };
}

/** Documentation status of every export of one published declaration file. */
function inspect(declPath) {
  const program = ts.createProgram([declPath], {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const source = program.getSourceFile(declPath);
  if (source === undefined) return undefined;
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) return undefined;

  const documented = [];
  const undocumented = [];
  const swallowed = [];

  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.getName();
    const verdict = classify(symbol, checker);
    if (verdict.kind === "documented") documented.push(name);
    else if (verdict.kind === "undocumented") undocumented.push(name);
    else swallowed.push({ name, tag: verdict.tag });
  }
  return { documented, undocumented, swallowed };
}

// PER ENTRY, not per package. This read `dist/index.d.ts` by name until 2026-08-20; the sibling
// repository `theokit-plugins` has eleven packages publishing eighteen declaration entries, and that
// version would have measured eleven of them while printing a percentage that reads as coverage of
// the whole published surface. Every package here declares exactly one `.` today, so the number is
// unchanged — but it is now derived from the manifest rather than assumed.
//
// The ESM declaration is what a reader's editor opens; the CJS sibling is the same content emitted
// twice, so counting both would double every total without measuring anything new.
const rows = [];
let failedToRead = 0;

for (const pkg of publishedPackages()) {
  if (!pkg.built) {
    console.error(`[${LABEL}] x ${pkg.name}: publishes no declaration — run the build`);
    failedToRead += 1;
    continue;
  }
  for (const entry of pkg.rows.filter((row) => row.decl.endsWith(".d.ts"))) {
    const result = inspect(entry.decl);
    if (result === undefined) {
      console.error(`[${LABEL}] x ${entry.specifier}: the compiler could not read the entry`);
      failedToRead += 1;
      continue;
    }
    const total = result.documented.length + result.undocumented.length + result.swallowed.length;
    rows.push({ name: entry.specifier, total, ...result });
  }
}

if (failedToRead > 0) {
  console.error(
    `[${LABEL}] FAIL — ${failedToRead} package(s) could not be read; nothing was measured for them.`,
  );
  process.exit(2);
}

if (LIST !== undefined) {
  const row = rows.find((entry) => entry.name === LIST || entry.name.endsWith(`/${LIST}`));
  if (row === undefined) {
    console.error(`[${LABEL}] x no package named ${LIST}`);
    process.exit(2);
  }
  console.log(`${row.name} — ${row.documented.length}/${row.total} documented`);
  for (const name of row.undocumented.sort()) console.log(`  undocumented  ${name}`);
  for (const item of row.swallowed)
    console.log(`  swallowed     ${item.name} (parsed as @${item.tag})`);
  process.exit(0);
}

const totalExports = rows.reduce((sum, row) => sum + row.total, 0);
const totalDocumented = rows.reduce((sum, row) => sum + row.documented.length, 0);
const overall = totalExports === 0 ? 0 : (totalDocumented / totalExports) * 100;

for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
  const percent = row.total === 0 ? 100 : (row.documented.length / row.total) * 100;
  const mark = percent >= FLOOR_PERCENT ? "ok" : "x ";
  console.log(
    `[${LABEL}] ${mark} ${row.name.padEnd(30)} ${row.documented.length
      .toString()
      .padStart(3)}/${row.total.toString().padEnd(3)} ${percent.toFixed(1).padStart(5)}%`,
  );
}

const below = rows.filter(
  (row) => row.total > 0 && (row.documented.length / row.total) * 100 < FLOOR_PERCENT,
);
const swallowedRows = rows.filter((row) => row.swallowed.length > 0);

console.log(
  `\n[${LABEL}] overall ${totalDocumented}/${totalExports} = ${overall.toFixed(1)}% (floor ${FLOOR_PERCENT}%)`,
);

if (swallowedRows.length > 0) {
  console.error(
    `\n[${LABEL}] x documentation written and swallowed — a first-line @tag ate the block:`,
  );
  for (const row of swallowedRows) {
    for (const item of row.swallowed) {
      console.error(`      ${row.name}: ${item.name} (parsed as @${item.tag})`);
    }
  }
  console.error(
    "  Start the block with prose; a specifier like `@theokit/gateway` on the first line",
  );
  console.error("  is read as a tag name and the text reaches no reader.");
}

if (below.length > 0) {
  console.error(
    `\n[${LABEL}] FAIL — ${below.length} package(s) below the ${FLOOR_PERCENT}% floor:`,
  );
  for (const row of below) {
    console.error(`      ${row.name} — run: node tools/check-doc-coverage.mjs --list ${row.name}`);
  }
}

if (below.length > 0 || swallowedRows.length > 0) process.exit(1);
console.log(`[${LABEL}] PASS — every package is at or above the ${FLOOR_PERCENT}% floor.`);
